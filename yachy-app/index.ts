import 'react-native-gesture-handler';
import './polyfillLocation';

import { registerRootComponent } from 'expo';

import App from './App';
import { installWebAlerts } from './src/utils/installWebAlerts';
import { completeWebAuthSession } from './src/utils/completeWebAuthSession';

completeWebAuthSession();
installWebAlerts();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
