module.exports = {
    skipFiles: ['test'],
    onServerReady: [ `npm run compile:lib` ],
    onCompileComplete: [ `npm run provision:lib:artefacts` ],
    providerOptions: { port: 8540 }
}