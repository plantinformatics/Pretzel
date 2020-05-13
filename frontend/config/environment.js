/* jshint node: true */

/* global module */
/* global process */

module.exports = function(environment) {
  var ENV = {
    modulePrefix: 'pretzel-frontend',
    environment: environment,
    apiHost: process.env.API_URL || 'http://localhost:5000',
    // apiHost: 'http://sc-15-cdc.it.csiro.au:7000',
    apiNamespace: 'api', // adding to the host for API calls
    rootURL: '/', // used with Ember local routing
    locationType: 'auto',
    handsOnTableLicenseKey: null,

    EmberENV: {
      FEATURES: {
        // Here you can enable experimental features on an ember canary build
        // e.g. 'with-controller': tru
      },
      EXTEND_PROTOTYPES: {
        // Prevent Ember Data from overriding Date.parse.
        Date: false,
      },
    },

    APP: {
      // Here you can pass flags/options to your application instance
      // when it is created
    },
  };

  if (environment === 'development') {
    // ENV.APP.LOG_RESOLVER = true;
    // ENV.APP.LOG_ACTIVE_GENERATION = true;
    // ENV.APP.LOG_TRANSITIONS = true;
    // ENV.APP.LOG_TRANSITIONS_INTERNAL = true;
    // ENV.APP.LOG_VIEW_LOOKUPS = true;
  }

  if (environment === 'test') {
    // Testem prefers this...
    ENV.locationType = 'none';

    // keep test console output quieter
    ENV.APP.LOG_ACTIVE_GENERATION = false;
    ENV.APP.LOG_VIEW_LOOKUPS = false;

    ENV.APP.rootElement = '#ember-testing';
  }

  if (environment === 'production') {
    ENV.apiHost = '';
  }

  /** Auth0 configuration
   * ClientID and domain are obtained from Auth0 dashboard for application
   */
  ENV.auth0 = {
    clientId: process.env.AUTH0_CLIENTID || 'mpMRCCydvSor9VD1MsxdnoKUSb3Rn1u7',
    domain: process.env.AUTH0_DOMAIN || 'pretzel-agribio.au.auth0.com',
    callbackUrl:
      process.env.AUTH0_CALLBACK_URL || 'http://localhost:4200/callback',
    logOutUrl: process.env.AUTH0_LOGOUT_URL || 'http://localhost:4200',
  };

  /** If handsOnTableLicenseKey is defined in the environment of npm / ember,
   * HandsOnTable is used for the spreadsheet-style tables in :
   *  components/panel/paths-table.js
   *  components/panel/upload/data-csv.js
   *  components/table-brushed.js
   * otherwise ember-contextual-table is used.
   *
   * In the last non-commercial HandsOnTable version 6.2.2, multiColumnSorting
   * is present but didn't work with 'multiColumnSorting:true'; it is fine for
   * all other features used.  To use this version, change "handsontable"
   * version dependency in frontend/bower.json (later this will be in
   * package.json)
   *
   * Also see : https://handsontable.com/blog/articles/2019/3/handsontable-drops-open-source-for-a-non-commercial-license
   * https://handsontable.com/docs/7.4.2/tutorial-license-key.html
   */
  ENV.handsOnTableLicenseKey = process.env.handsOnTableLicenseKey;

  return ENV;
};
