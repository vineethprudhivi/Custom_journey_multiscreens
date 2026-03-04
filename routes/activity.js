'use strict';
const axios = require("axios");
const crypto = require("crypto");

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

// ═══════════════════════════════════════════════════════════════════════
//  NEW ENDPOINTS – Multi-screen POC
// ═══════════════════════════════════════════════════════════════════════

/**
 * POST /webhook/submit
 * Simulates a CloudPage → JS Code Resource webhook.
 *   1. Receives form data (firstname, lastname, email, phone, country).
 *   2. Saves it to a "Webhook Data" DE (env: WEBHOOK_DE_KEY).
 *   3. Generates a GUID job ID.
 *   4. Saves the GUID to a "Job Tracking" DE (env: JOB_TRACKING_DE_KEY).
 *   5. Returns the GUID to the caller.
 */
exports.webhookSubmit = async function (req, res) {
    try {
        const { firstname, lastname, email, phone, country, jobId: clientJobId } = req.body || {};

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required.' });
        }

        // Use client-provided GUID if available, otherwise generate server-side
        const jobId = clientJobId || crypto.randomUUID();

        // Attempt to persist via SFMC REST API if credentials are configured
        const hasCredentials = (process.env.CLIENT_ID || process.env.clientId) &&
                               (process.env.CLIENT_SECRET || process.env.clientSecret) &&
                               subdomain;

        if (hasCredentials) {
            const token = await retrieveToken();

            // 1. Save webhook form data to the Webhook DE
            const webhookDEKey = process.env.WEBHOOK_DE_KEY || 'WebhookData_DE';
            try {
                await upsertDataExtensionRow(token, webhookDEKey, 'email', {
                    email,
                    firstname: firstname || '',
                    lastname: lastname || '',
                    phone: phone || '',
                    country: country || '',
                    jobId
                });
                console.log(`Webhook form data saved to DE '${webhookDEKey}' for ${email}`);
            } catch (err) {
                console.error('Failed to save webhook form data:', err.response ? err.response.data : err.message);
            }

            // 2. Save the GUID in the Job Tracking DE (independent try/catch)
            const jobTrackingDEKey = process.env.JOB_TRACKING_DE_KEY || 'JobTracking_DE';
            try {
                await upsertDataExtensionRow(token, jobTrackingDEKey, 'jobId', {
                    jobId,
                    email,
                    status: 'submitted',
                    createdDate: new Date().toISOString()
                });
                console.log(`Job tracking saved to DE '${jobTrackingDEKey}' with jobId=${jobId}`);
            } catch (err) {
                console.error(`Failed to save to Job Tracking DE '${jobTrackingDEKey}':`, err.response ? JSON.stringify(err.response.data) : err.message);
                console.error('Make sure the DE exists with fields: jobId (PK, Text 50), email (Text 254), status (Text 50), createdDate (Text 50)');
            }
        } else {
            console.log(`[Mock] No SFMC credentials – skipping DE writes. Generated Job ID: ${jobId}`);
        }

        return res.status(200).json({ success: true, jobId });
    } catch (error) {
        console.error('webhookSubmit error:', error.response ? error.response.data : error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /de/records/:deKey
 * Returns the top 2 rows from the specified Data Extension.
 */
exports.getDeRecords = async function (req, res) {
    try {
        const deKey = (req.params.deKey || '').trim();
        if (!deKey) {
            return res.status(400).json({ success: false, error: 'Missing DE key.' });
        }

        console.log('=== getDeRecords called for DE:', deKey, '===');

        const hasCredentials = (process.env.CLIENT_ID || process.env.clientId) &&
                               (process.env.CLIENT_SECRET || process.env.clientSecret) &&
                               subdomain;

        if (!hasCredentials) {
            console.log('[Mock] Returning sample records for DE:', deKey);
            return res.status(200).json({
                success: true,
                records: [
                    { SubscriberKey: 'mock-001', FirstName: 'Jane', LastName: 'Doe', Email: 'jane@example.com' },
                    { SubscriberKey: 'mock-002', FirstName: 'John', LastName: 'Smith', Email: 'john@example.com' }
                ]
            });
        }

        const token = await retrieveToken();

        // SFMC REST: retrieve DE rows via /data/v1/customobjectdata
        const url = `${restBaseURL}/data/v1/customobjectdata/key/${encodeURIComponent(deKey)}/rowset?$page=1&$pageSize=2`;
        console.log('Fetching DE records from:', url);

        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('DE records response status:', response.status);
        console.log('DE records response keys:', Object.keys(response.data || {}));

        // Normalise – response.data.items is an array of { keys: {}, values: {} }
        let records = [];
        if (response.data && response.data.items) {
            records = response.data.items.map(function (item) {
                return Object.assign({}, item.keys || {}, item.values || {});
            });
        } else if (Array.isArray(response.data)) {
            // Some endpoints return a plain array
            records = response.data.map(function (item) {
                if (item.keys || item.values) {
                    return Object.assign({}, item.keys || {}, item.values || {});
                }
                return item;
            });
        }

        console.log('Returning', records.length, 'records');
        return res.status(200).json({ success: true, records });
    } catch (error) {
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        const errStatus = error.response ? error.response.status : 'N/A';
        console.error(`getDeRecords error [${errStatus}]:`, errData);
        return res.status(200).json({ success: false, error: `DE fetch failed (${errStatus}): ${errData}` });
    }
};
