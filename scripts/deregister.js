// Usage: ./execute.sh deregister.js staging --module 0x9ABb5Db4B23A866ffd649716c6ce2674b2C28C17abc

const ModuleRegistry = require("../build/ModuleRegistry");
const MultiSig = require("../build/MultiSigWallet");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");


async function main() {
  // Read Command Line Arguments
  let idx = process.argv.indexOf("--network");
  const network = process.argv[idx + 1];

  idx = process.argv.indexOf("--module");
  const targetModule = process.argv[idx + 1];

  // Setup deployer
  const manager = new DeployManager(network);
  await manager.setup();
  const { configurator } = manager;
  const { deployer } = manager;
  const deploymentWallet = deployer.signer;
  const { config } = configurator;

  const ModuleRegistryWrapper = await deployer.wrapDeployedContract(ModuleRegistry, config.contracts.ModuleRegistry);
  const MultiSigWrapper = await deployer.wrapDeployedContract(MultiSig, config.contracts.MultiSigWallet);
  const multisigExecutor = new MultisigExecutor(MultiSigWrapper, deploymentWallet, config.multisig.autosign);

  // deregister
  await multisigExecutor.executeCall(ModuleRegistryWrapper, "deregisterModule", [targetModule]);
}

main().catch((err) => {
  throw err;
});
