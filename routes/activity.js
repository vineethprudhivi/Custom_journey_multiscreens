'use strict';
const axios = require("axios");

// Global Variables - Build URLs from environment variables
const subdomain = process.env.SUBDOMAIN || '';
const authenticationUrl = process.env.authenticationUrl || `https://${subdomain}.auth.marketingcloudapis.com`;
const restBaseURL = process.env.restBaseURL || `https://${subdomain}.rest.marketingcloudapis.com`;
const tokenURL = `${authenticationUrl}/v2/token`;

/*
 * POST Handlers for various routes
 */
exports.edit = function (req, res) {
    res.status(200).json({ success: true });
};

exports.save = async function (req, res) {
    try {
        const payload = req.body;
        await saveToDatabase(payload);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ success: false, error: 'Error saving data' });
    }
};

exports.execute = async function (req, res) {
    try {
        console.log('=== Execute called ===');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        const args = (req.body && req.body.inArguments && req.body.inArguments[0]) ? req.body.inArguments[0] : {};

        const destinationDE = (args.destinationDE || process.env.TARGET_DE_KEY || '').trim();
        const upsertKey = args.upsertKey || 'id';
        const fieldMappings = (args.fieldMappings && typeof args.fieldMappings === 'object') ? args.fieldMappings : {};

        console.log('Destination DE:', destinationDE);
        console.log('Upsert Key:', upsertKey);
        console.log('Field Mappings:', JSON.stringify(fieldMappings, null, 2));

        if (!destinationDE) {
            console.error('Execute error: missing destinationDE (set in UI or env TARGET_DE_KEY)');
            return res.status(200).json({ success: false, error: 'Missing destinationDE' });
        }
        
        if (Object.keys(fieldMappings).length === 0) {
            console.error('Execute error: no fields selected for upsert');
            return res.status(200).json({ success: false, error: 'No fields selected' });
        }

        // Journey Builder will have already resolved {{...}} templates into actual values
        const primaryKeyValue = fieldMappings[upsertKey];
        
        if (!primaryKeyValue) {
            console.error(`Execute error: upsert key '${upsertKey}' not found in field mappings`);
            return res.status(200).json({ success: false, error: 'Upsert key not found' });
        }

        const token = await retrieveToken();
        await upsertDataExtensionRow(token, destinationDE, upsertKey, fieldMappings);

        console.log(`Successfully upserted row into DE '${destinationDE}' with ${upsertKey}=${primaryKeyValue}`);
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error during DE upsert execution:', error.response ? error.response.data : error.message);
        return res.status(200).json({ success: false }); // Do not stop the journey
    }
};


exports.publish = function (req, res) {
    res.status(200).json({ success: true });
};

exports.validate = function (req, res) {
    res.status(200).json({ success: true });
};

exports.stop = function (req, res) {
    res.status(200).json({ success: true });
};

/*
 * Function to retrieve an access token
 */
async function retrieveToken() {
    try {
        const clientId = process.env.CLIENT_ID || process.env.clientId;
        const clientSecret = process.env.CLIENT_SECRET || process.env.clientSecret;
        
        if (!clientId || !clientSecret) {
            throw new Error('Missing CLIENT_ID or CLIENT_SECRET environment variables');
        }
        
        const response = await axios.post(tokenURL, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Error retrieving token:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function upsertDataExtensionRow(token, dataExtensionKey, primaryKeyField, fieldMappings) {
    if (!restBaseURL) {
        throw new Error('Missing SUBDOMAIN or restBaseURL environment variable');
    }

    const url = `${restBaseURL}/hub/v1/dataevents/key:${encodeURIComponent(dataExtensionKey)}/rowset`;
    
    // Build the keys and values for the upsert
    // fieldMappings already contains resolved values from Journey Builder
    const keys = {
        [primaryKeyField]: fieldMappings[primaryKeyField]
    };
    
    const rowsetPayload = [
        {
            keys: keys,
            values: fieldMappings
        }
    ];

    console.log('Upserting to DE:', JSON.stringify(rowsetPayload, null, 2));

    await axios.post(url, rowsetPayload, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
}

/*
 * GET Handler for /journeys route
 */
exports.getJourneys = async function (req, res) {
    res.status(404).json({ error: 'Not implemented in DE copy mode' });
}

/*
 * Function to retrieve journeys
 */
async function fetchJourneys() {
    throw new Error('Not implemented');
}

/*
 * Handler to get activity data by UUID
 */
exports.getActivityByUUID = async function (req, res) {
    res.status(404).send('Not implemented in DE copy mode');
}


/*
 * Function to save data to the database
 */
async function saveToDatabase() {
    return;
}
