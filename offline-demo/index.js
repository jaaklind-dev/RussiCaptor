// This entry never imports the production router or bootstrap.
const { installOfflineNetworkBoundary } = require('./src/networkBoundary');
installOfflineNetworkBoundary(globalThis);
const { registerRootComponent } = require('expo');
const App = require('./src/DemoApp').default;
registerRootComponent(App);
