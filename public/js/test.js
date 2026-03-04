/**
 * Custom Journey Activity – 3-Screen Postmonger Flow
 * Screen 1: Webhook form (firstname, lastname, email, phone, country)
 * Screen 2: Display field names from the journey Entry DE
 * Screen 3: Pull top 2 records from the Entry DE for preview / test
 */

// ─── Postmonger Session ──────────────────────────────────────────────
var connection = new Postmonger.Session();
var payload     = {};
var schema      = [];
var currentStep = 1;
var webhookJobId = null;
var entryDeKey   = null;   // extracted from schema keys

// ─── Bootstrap ───────────────────────────────────────────────────────
$(window).ready(function () {
    connection.trigger('ready');          // stop JB loading spinner
    connection.trigger('requestSchema');  // ask for Entry DE schema
});

// ─── Postmonger Events ──────────────────────────────────────────────

connection.on('initActivity', function (data) {
    if (data) { payload = data; }
    hydrateFromExistingPayload();

    // Show step 1 and request Next button
    showStep(1);
    connection.trigger('updateButton', { button: 'next', text: 'Next', visible: true, enabled: true });
    connection.trigger('updateButton', { button: 'back', visible: false });
});

connection.on('requestedSchema', function (data) {
    if (!data || !data.schema) {
        console.warn('No schema data received');
        return;
    }
    schema = data.schema;

    // Derive the Entry DE external key from the first schema key
    // Key format: "Event.<DEExternalKey>.<FieldName>"
    if (schema.length > 0 && schema[0].key) {
        var parts = schema[0].key.split('.');
        if (parts.length >= 2) {
            entryDeKey = parts[1];
        }
    }

    // Pre-populate Screen 2 field table (available even before user reaches it)
    populateEntryDeFields(schema);
});

// ─── Step Navigation ─────────────────────────────────────────────────

connection.on('gotoStep', function (step) {
    var stepNum = parseInt((step.key || '').replace('step', ''), 10);
    if (!isNaN(stepNum)) {
        currentStep = stepNum;
        showStep(currentStep);

        // Update button visibility per step
        if (currentStep === 1) {
            connection.trigger('updateButton', { button: 'next', text: 'Next', visible: true, enabled: true });
            connection.trigger('updateButton', { button: 'back', visible: false });
        } else if (currentStep === 2) {
            connection.trigger('updateButton', { button: 'next', text: 'Next', visible: true, enabled: true });
            connection.trigger('updateButton', { button: 'back', visible: true });
        } else if (currentStep === 3) {
            connection.trigger('updateButton', { button: 'next', text: 'Done', visible: true, enabled: true });
            connection.trigger('updateButton', { button: 'back', visible: true });
            fetchPreviewRecords();
            showJobIdSummary();
        }
    }
});

connection.on('clickedNext', function () {
    if (currentStep === 1) {
        submitWebhookForm();   // async – will call nextStep on success
    } else if (currentStep === 2) {
        connection.trigger('nextStep');
    } else if (currentStep === 3) {
        saveActivity();
    }
});

connection.on('clickedBack', function () {
    connection.trigger('prevStep');
});

// ─── UI Helpers ──────────────────────────────────────────────────────

function showStep(num) {
    $('.step').hide();
    $('#step' + num).show();
}

// ─── Screen 1  – Webhook form submit ────────────────────────────────

function submitWebhookForm() {
    var formData = {
        firstname : ($('#firstname').val() || '').trim(),
        lastname  : ($('#lastname').val()  || '').trim(),
        email     : ($('#email').val()     || '').trim(),
        phone     : ($('#phone').val()     || '').trim(),
        country   : ($('#country').val()   || '').trim()
    };

    // Basic validation
    if (!formData.email) {
        $('#webhookStatus').html('<span style="color:#c23934;">Email is required.</span>');
        return;
    }

    $('#webhookStatus').html('<span style="color:#888;">Submitting to webhook…</span>');

    $.ajax({
        url: '/webhook/submit',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(formData),
        success: function (res) {
            if (res.success) {
                webhookJobId = res.jobId;
                $('#webhookStatus').html(
                    '<span style="color:#2e844a;">&#10003; Submitted! Job ID: <strong>' +
                    webhookJobId + '</strong></span>'
                );
                // Brief pause so the user sees the confirmation
                setTimeout(function () {
                    connection.trigger('nextStep');
                }, 800);
            } else {
                $('#webhookStatus').html(
                    '<span style="color:#c23934;">Error: ' +
                    (res.error || 'Unknown error') + '</span>'
                );
            }
        },
        error: function () {
            $('#webhookStatus').html(
                '<span style="color:#c23934;">Request failed. Ensure the server is running and SFMC credentials are configured.</span>'
            );
        }
    });
}

// ─── Screen 2  – Entry DE field names ───────────────────────────────

function populateEntryDeFields(schemaArr) {
    var $tbody = $('#entryDeFieldsTable tbody');
    $tbody.empty();

    if (!schemaArr || schemaArr.length === 0) {
        $tbody.append('<tr><td colspan="4" class="empty-msg">No fields found in Entry DE.</td></tr>');
        return;
    }

    schemaArr.forEach(function (field, idx) {
        if (!field || !field.key) return;
        var parts     = field.key.split('.');
        var fieldName = parts[parts.length - 1];
        var fieldType = field.type || 'Text';

        $tbody.append(
            '<tr>' +
                '<td>' + (idx + 1)  + '</td>' +
                '<td>' + fieldName  + '</td>' +
                '<td>' + fieldType  + '</td>' +
                '<td style="font-size:11px;color:#666;">' + field.key + '</td>' +
            '</tr>'
        );
    });

    if (entryDeKey) {
        $('#entryDeKeyDisplay').text(entryDeKey);
    }
}

// ─── Screen 3  – Preview top 2 records ───────────────────────────────

function fetchPreviewRecords() {
    if (!entryDeKey) {
        $('#previewStatus').html(
            '<span style="color:#b26500;">No Entry DE key detected from the journey schema.</span>'
        );
        return;
    }

    $('#previewStatus').html('<span style="color:#888;">Fetching top 2 records from <strong>' + entryDeKey + '</strong>…</span>');

    $.ajax({
        url: '/de/records/' + encodeURIComponent(entryDeKey),
        method: 'GET',
        success: function (res) {
            if (res.success && res.records && res.records.length > 0) {
                renderPreviewTable(res.records);
                $('#previewStatus').html(
                    '<span style="color:#2e844a;">Showing top ' + res.records.length + ' record(s) from <strong>' + entryDeKey + '</strong></span>'
                );
            } else {
                $('#previewStatus').html(
                    '<span style="color:#b26500;">No records found in the Entry DE.</span>'
                );
            }
        },
        error: function () {
            $('#previewStatus').html(
                '<span style="color:#c23934;">Failed to fetch records. Check server / SFMC credentials.</span>'
            );
        }
    });
}

function renderPreviewTable(records) {
    if (!records || records.length === 0) return;

    // Collect all unique field names across records
    var fieldSet = {};
    records.forEach(function (r) { Object.keys(r).forEach(function (k) { fieldSet[k] = true; }); });
    var fields = Object.keys(fieldSet);

    var headerHtml = '<thead><tr>';
    fields.forEach(function (f) { headerHtml += '<th>' + f + '</th>'; });
    headerHtml += '</tr></thead>';

    var bodyHtml = '<tbody>';
    records.forEach(function (record) {
        bodyHtml += '<tr>';
        fields.forEach(function (f) {
            bodyHtml += '<td>' + (record[f] !== undefined && record[f] !== null ? record[f] : '') + '</td>';
        });
        bodyHtml += '</tr>';
    });
    bodyHtml += '</tbody>';

    $('#previewRecordsTable').html(headerHtml + bodyHtml);
}

function showJobIdSummary() {
    if (webhookJobId) {
        $('#jobIdSummary').html(
            '<strong>Webhook Job ID:</strong> ' + webhookJobId
        );
    }
}

// ─── Save Activity (final step) ─────────────────────────────────────

function saveActivity() {
    payload.arguments           = payload.arguments           || {};
    payload.arguments.execute   = payload.arguments.execute   || {};
    payload.metaData            = payload.metaData            || {};

    // Map every Entry DE field as an inArgument using handlebars syntax
    var fieldMappings = {};
    (schema || []).forEach(function (field) {
        if (!field || !field.key) return;
        var parts     = field.key.split('.');
        var fieldName = parts[parts.length - 1];
        fieldMappings[fieldName] = '{{' + field.key + '}}';
    });

    payload.arguments.execute.inArguments = [{
        entryDeKey    : entryDeKey,
        webhookJobId  : webhookJobId,
        fieldMappings : fieldMappings
    }];

    payload.metaData.isConfigured = true;
    connection.trigger('updateActivity', payload);
}

// ─── Hydrate from previously saved payload ──────────────────────────

function hydrateFromExistingPayload() {
    var existing = payload && payload.arguments && payload.arguments.execute &&
                   payload.arguments.execute.inArguments;
    if (!existing || existing.length === 0) return;

    var args = existing[0] || {};

    if (args.webhookJobId) {
        webhookJobId = args.webhookJobId;
        $('#webhookStatus').html(
            '<span style="color:#2e844a;">Previously submitted. Job ID: <strong>' +
            webhookJobId + '</strong></span>'
        );
    }
    if (args.entryDeKey) {
        entryDeKey = args.entryDeKey;
    }
}
