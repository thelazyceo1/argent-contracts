const GuardianManager = require("../build/GuardianManager");
const LockManager = require("../build/LockManager");
const RecoveryManager = require("../build/RecoveryManager");
const GuardianStorage = require("../build/GuardianStorage");
const Wallet = require("../build/BaseWallet");
const Registry = require("../build/ModuleRegistry");

const TestManager = require("../utils/test-manager");
const { sortWalletByAddress, parseRelayReceipt } = require("../utils/utilities.js");

describe("RecoveryManager", function () {
    this.timeout(10000);

    const manager = new TestManager(accounts);

    let owner = accounts[1].signer;
    let guardian1 = accounts[2].signer;
    let guardian2 = accounts[3].signer;
    let guardian3 = accounts[4].signer;
    let newowner = accounts[5].signer;
    let nonowner = accounts[6].signer;

    let guardianManager, guardianStorage, lockManager, recoveryManager, wallet;

    beforeEach(async () => {
        deployer = manager.newDeployer();
        const registry = await deployer.deploy(Registry);
        guardianStorage = await deployer.deploy(GuardianStorage);
        guardianManager = await deployer.deploy(GuardianManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24, 12);
        lockManager = await deployer.deploy(LockManager, {}, registry.contractAddress, guardianStorage.contractAddress, 24 * 5);
        recoveryManager = await deployer.deploy(RecoveryManager, {}, registry.contractAddress, guardianStorage.contractAddress, 36, 24 * 5, 24, 12);
        wallet = await deployer.deploy(Wallet);
        await wallet.init(owner.address, [guardianManager.contractAddress, lockManager.contractAddress, recoveryManager.contractAddress]);
    });

    async function addGuardians(guardians) {
        // guardians can be Wallet or ContractWrapper objects
        let guardianAddresses = guardians.map(guardian => {
            if (guardian.address)
                return guardian.address;
            return guardian.contractAddress;
        });

        for (const address of guardianAddresses) {
            await guardianManager.from(owner).addGuardian(wallet.contractAddress, address);
        }

        await manager.increaseTime(30);
        for (let i = 1; i < guardianAddresses.length; i++) {
            await guardianManager.confirmGuardianAddition(wallet.contractAddress, guardianAddresses[i]);
        }
        const count = (await guardianManager.guardianCount(wallet.contractAddress)).toNumber();
        assert.equal(count, guardians.length, `${guardians.length} guardians should be added`);
    }

    async function createSmartContractGuardians(guardians) {
        const wallets = []
        for (g of guardians) {
            const wallet = await deployer.deploy(Wallet);
            await wallet.init(g.address, [guardianManager.contractAddress]);
            wallets.push(wallet)
        }
        return wallets
    }

    function testExecuteRecovery(guardians) {
        it("should let a majority of guardians execute the recovery procedure", async () => {
            let majority = guardians.slice(0, Math.ceil((guardians.length) / 2));
            await manager.relay(recoveryManager, 'executeRecovery', [wallet.contractAddress, newowner.address], wallet, sortWalletByAddress(majority));
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isTrue(isLocked, "should be locked by recovery");
        });

        it("should not let a majority of guardians and owner execute the recovery procedure", async () => {
            let majority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
            let txReceipt = await manager.relay(recoveryManager, 'executeRecovery', [wallet.contractAddress, newowner.address], wallet, [owner, ...sortWalletByAddress(majority)]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "executeRecovery should fail");
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isFalse(isLocked, "should not be locked");
        });

        it("should not let a minority of guardians execute the recovery procedure", async () => {
            let minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);
            let txReceipt = await manager.relay(recoveryManager, 'executeRecovery', [wallet.contractAddress, newowner.address], wallet, sortWalletByAddress(minority));
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "executeRecovery should fail");
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isFalse(isLocked, "should not be locked");
        });
    }

    function testFinalizeRecovery() {
        it("should let anyone finalize the recovery procedure after the recovery period", async () => {
            await manager.increaseTime(40); // moving time to after the end of the recovery period
            await manager.relay(recoveryManager, 'finalizeRecovery', [wallet.contractAddress], wallet, []);
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isFalse(isLocked, "should no longer be locked after finalization of recovery");
            const walletOwner = await wallet.owner();
            assert.equal(walletOwner, newowner.address, "wallet owner should have been changed");
        });

        it("should not let anyone finalize the recovery procedure before the end of the recovery period", async () => {
            const txReceipt = await manager.relay(recoveryManager, 'finalizeRecovery', [wallet.contractAddress], wallet, []);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, 'finalization should have failed')

            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isTrue(isLocked, "should still be locked");
        });
    }

    function testCancelRecovery() {
        it("should let 2 guardians cancel the recovery procedure", async () => {
            await manager.relay(recoveryManager, 'cancelRecovery', [wallet.contractAddress], wallet, sortWalletByAddress([guardian1, guardian2]));
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isFalse(isLocked, "should no longer be locked by recovery");
            await manager.increaseTime(40); // moving time to after the end of the recovery period
            const txReceipt = await manager.relay(recoveryManager, 'finalizeRecovery', [wallet.contractAddress], wallet, []);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, 'finalization should have failed');
            const walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, "wallet owner should not have been changed");
        });

        it("should let 1 guardian + owner cancel the recovery procedure", async () => {
            await manager.relay(recoveryManager, 'cancelRecovery', [wallet.contractAddress], wallet, [owner, guardian1]);
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isFalse(isLocked, "should no longer be locked by recovery");
            await manager.increaseTime(40); // moving time to after the end of the recovery period
            const txReceipt = await manager.relay(recoveryManager, 'finalizeRecovery', [wallet.contractAddress], wallet, []);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, 'finalization should have failed');
            const walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, "wallet owner should not have been changed");
        });

        it("should not let 1 guardian cancel the recovery procedure", async () => {
            let txReceipt = await manager.relay(recoveryManager, 'cancelRecovery', [wallet.contractAddress], wallet, [guardian1]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "cancelRecovery should fail");
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isTrue(isLocked, "should still be locked");
        });

        it("should not let the owner cancel the recovery procedure", async () => {
            let txReceipt = await manager.relay(recoveryManager, 'cancelRecovery', [wallet.contractAddress], wallet, [owner]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "cancelRecovery should fail");
            const isLocked = await lockManager.isLocked(wallet.contractAddress);
            assert.isTrue(isLocked, "should still be locked");
        });
    }

    function testOwnershipTransfer(guardians) {
        it("should let owner + the majority of guardians execute an ownership transfer", async () => {
            const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));

            await manager.relay(recoveryManager, 'transferOwnership', [wallet.contractAddress, newowner.address], wallet, [owner, ...sortWalletByAddress(majority)]);
            const walletOwner = await wallet.owner();
            assert.equal(walletOwner, newowner.address, 'owner should have been changed');
        });

        it("should not let owner + minority of guardians execute an ownership transfer", async () => {
            const minority = guardians.slice(0, Math.ceil((guardians.length) / 2) - 1);

            let txReceipt = await manager.relay(recoveryManager, 'transferOwnership', [wallet.contractAddress, newowner.address], wallet, [owner, ...minority]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "transferOwnership should fail");

            const walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'owner should not have been changed');
        });

        it("should not let majority of guardians execute an ownership transfer without owner", async () => {
            const majority = guardians.slice(0, Math.ceil((guardians.length) / 2));
            
            let txReceipt = await manager.relay(recoveryManager, 'transferOwnership', [wallet.contractAddress, newowner.address], wallet, [...majority]);
            const success = parseRelayReceipt(txReceipt);
            assert.isNotOk(success, "transferOwnership should fail");

            const walletOwner = await wallet.owner();
            assert.equal(walletOwner, owner.address, 'owner should not have been changed');
        });
    }

    describe("Execute Recovery", () => {
        describe("EOA Guardians: G = 2", () => {
            beforeEach(async () => {
                await addGuardians([guardian1, guardian2])
            });

            testExecuteRecovery([guardian1, guardian2]);
        });

        describe("EOA Guardians: G = 3", () => {
            beforeEach(async () => {
                await addGuardians([guardian1, guardian2, guardian3])
            });

            testExecuteRecovery([guardian1, guardian2, guardian3]);
        });

        describe("Smart Contract Guardians: G = 2", () => {
            let guardians;
            beforeEach(async () => {
                guardians = await createSmartContractGuardians([guardian1, guardian2]);
                await addGuardians(guardians);
            });

            testExecuteRecovery([guardian1, guardian2]);
        });

        describe("Smart Contract Guardians: G = 3", () => {
            let guardians;
            beforeEach(async () => {
                guardians = await createSmartContractGuardians([guardian1, guardian2, guardian3]);
                await addGuardians(guardians);
            });

            testExecuteRecovery([guardian1, guardian2, guardian3]);
        });
    });

    describe("Finalize Recovery", () => {
        beforeEach(async () => {
            await addGuardians([guardian1, guardian2, guardian3])
            await manager.relay(recoveryManager, 'executeRecovery', [wallet.contractAddress, newowner.address], wallet, sortWalletByAddress([guardian1, guardian2]));
        });

        testFinalizeRecovery();
    })

    describe("Cancel Recovery with 3 guardians", () => {
        describe("EOA Guardians", () => {
            beforeEach(async () => {
                await addGuardians([guardian1, guardian2, guardian3])
                await manager.relay(recoveryManager, 'executeRecovery', [wallet.contractAddress, newowner.address], wallet, sortWalletByAddress([guardian1, guardian2]));
            });

            testCancelRecovery();
        });
        describe("Smart Contract Guardians", () => {
            beforeEach(async () => {
                await addGuardians(await createSmartContractGuardians([guardian1, guardian2, guardian3]));
                await manager.relay(recoveryManager, 'executeRecovery', [wallet.contractAddress, newowner.address], wallet, sortWalletByAddress([guardian1, guardian2]));
            });

            testCancelRecovery();
        });
    })

    describe("Ownership Transfer", () => {
        describe("Guardians: G = 1", () => {
            beforeEach(async () => {
                await addGuardians([guardian1]);
            });

            testOwnershipTransfer([guardian1]);
        });

        describe("Guardians: G = 2", () => {
            beforeEach(async () => {
                await addGuardians([guardian1, guardian2]);
            });

            testOwnershipTransfer([guardian1, guardian2]);
        });

        describe("Guardians: G = 3", () => {
            beforeEach(async () => {
                await addGuardians([guardian1, guardian2, guardian3]);
            });

            testOwnershipTransfer([guardian1, guardian2, guardian3]);
        });
    });
});