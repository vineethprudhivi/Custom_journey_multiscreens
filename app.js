'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const errorhandler = require('errorhandler');
const path = require('path');
const http = require('http');
const routes = require('./routes');
const activity = require('./routes/activity');

// EXPRESS CONFIGURATION
const app = express();

// CORS Configuration - CRITICAL for Marketing Cloud
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Configure Express
app.set('port', process.env.PORT || 3000);
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Express in Development Mode
if ('development' === app.get('env')) {
  app.use(errorhandler());
}

app.get('/', routes.index);
app.post('/', activity.execute);
app.post('/login', routes.login);
app.post('/logout', routes.logout);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        env: {
            hasClientId: !!process.env.CLIENT_ID,
            hasClientSecret: !!process.env.CLIENT_SECRET,
            hasSubdomain: !!process.env.SUBDOMAIN
        }
    });
});

// Custom Routes for MC
app.post('/journeybuilder/save/', activity.save);
app.post('/journeybuilder/validate/', activity.validate);
app.post('/journeybuilder/publish/', activity.publish);
app.post('/journeybuilder/execute/', activity.execute);
app.post('/journeybuilder/edit/', activity.edit);
app.post('/journeybuilder/stop/', activity.stop);

// Backwards-compatible aliases (some configs use /save, /execute, etc.)
app.post('/save', activity.save);
app.post('/validate', activity.validate);
app.post('/publish', activity.publish);
app.post('/execute', activity.execute);
app.post('/edit', activity.edit);
app.post('/stop', activity.stop);

// New route to get journeys
app.get('/journeys', activity.getJourneys);

// New route to get activity data by UUID
app.get('/activity/:uuid', activity.getActivityByUUID);

// Start server locally, or export for Vercel
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  http.createServer(app).listen(
    app.get('port'), function(){
      console.log('Express server listening on port ' + app.get('port'));
    }
  );
}

// Export for Vercel
module.exports = app;
