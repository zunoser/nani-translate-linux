'use strict';
const {app}=require('electron');
const path=require('node:path');
app.setName('Nani Community');
const profile=app.commandLine.getSwitchValue('user-data-dir')||path.join(app.getPath('appData'),'nani-community');
app.setPath('userData',profile);
app.setPath('sessionData',profile);
globalThis.$naniCommunity=require('./runtime.cjs').initialize();
require('../out/main/index.js');
