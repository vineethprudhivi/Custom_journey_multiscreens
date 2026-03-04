/**
 * Custom Journey Activity – 3-Screen Postmonger Flow
 * Screen 1: Webhook form (firstname, lastname, email, phone, country) + GUID
 * Screen 2: Display field names from the journey Entry DE
 * Screen 3: Pull top 2 records from the Entry DE for preview / test
 *
 * Navigation is handled via in-page buttons (reliable in all JB environments).
 * Postmonger gotoStep is also handled as a secondary hook.
 */

// ─── Postmonger Session ──────────────────────────────────────────────
var connection   = new Postmonger.Session();
var payload      = {};
var schema       = [];
var currentStep  = 1;
var totalSteps   = 3;
var webhookJobId = null;
var entryDeKey   = null;

// Base URL for API calls (same origin as iframe)
var BASE_URL = [location.protocol, '//', location.host].join('');

// ─── Bootstrap ───────────────────────────────────────────────────────
$(window).ready(function () {
    connection.trigger('ready');          // stop JB loading spinner
    connection.trigger('requestSchema');  // ask for Entry DE schema
    showStep(1);
});

// ─── Postmonger Events ──────────────────────────────────────────────

connection.on('initActivity', function (data) {
    if (data) { payload = data; }
    hydrateFromExistingPayload();
    showStep(1);
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

    // Pre-populate Screen 2 field table
    populateEntryDeFields(schema);
});

// Also handle JB-level step navigation if steps ARE recognized
connection.on('gotoStep', function (step) {
    var stepNum = parseInt((step.key || '').replace('step', ''), 10);
    if (!isNaN(stepNum)) {
        goToStep(stepNum);
    }
});

// If JB fires clickedNext (Done button), save the activity
connection.on('clickedNext', function () {
    saveActivity();
});

connection.on('clickedBack', function () {
    if (currentStep > 1) goToStep(currentStep - 1);
});

// ─── In-Page Navigation (primary) ────────────────────────────────────

// Called by HTML onclick
function navigateNext() {
    if (currentStep === 1) {
        submitWebhookForm();  // goes to step 2 on success
    } else if (currentStep === 2) {
        goToStep(3);
    } else if (currentStep === 3) {
        saveActivity();
    }
}

function navigateBack() {
    if (currentStep > 1) {
        goToStep(currentStep - 1);
    }
}

// Expose globally for onclick attributes
window.navigateNext = navigateNext;
window.navigateBack = navigateBack;

function goToStep(num) {
    currentStep = num;
    showStep(num);

    if (num === 3) {
        fetchPreviewRecords();
        showJobIdSummary();
    }
}

function showStep(num) {
    // Toggle step panels
    $('.step').hide();
    $('#step' + num).show();

    // Update step indicator
    $('.step-dot').each(function () {
        var dotStep = parseInt($(this).data('step'), 10);
        $(this).removeClass('active completed');
        if (dotStep === num) {
            $(this).addClass('active');
        } else if (dotStep < num) {
            $(this).addClass('completed');
        }
    });

    // Toggle in-page buttons
    $('#btnBack').toggle(num > 1);
    if (num < totalSteps) {
        $('#btnNext').text('Next →').show();
    } else {
        $('#btnNext').text('Save & Done ✓').show();
    }
}

// ─── Screen 1 – Webhook form submit ─────────────────────────────────

function submitWebhookForm() {
    var formData = {
        firstname : ($('#firstname').val() || '').trim(),
        lastname  : ($('#lastname').val()  || '').trim(),
        email     : ($('#email').val()     || '').trim(),
        phone     : ($('#phone').val()     || '').trim(),
        country   : ($('#country').val()   || '').trim()
    };

    if (!formData.email) {
        $('#webhookStatus').html('<span style="color:#c23934;">Email is required.</span>');
        return;
    }

    // Generate GUID client-side (reliable, no server dependency)
    webhookJobId = UUIDjs.create(4).toString();

    $('#webhookStatus').html('<span style="color:#888;">Submitting…</span>');
    $('#btnNext').prop('disabled', true);

    // Fire-and-forget POST to server (saves to DEs if SFMC creds are configured)
    $.ajax({
        url: BASE_URL + '/webhook/submit',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify($.extend({}, formData, { jobId: webhookJobId })),
        timeout: 8000,
        success: function (res) {
            // If server returned its own jobId, prefer it
            if (res && res.success && res.jobId) {
                webhookJobId = res.jobId;
            }
            showWebhookSuccess();
        },
        error: function () {
            // Server unreachable / creds missing – still proceed with client GUID
            console.warn('Webhook POST failed – using client-generated GUID');
            showWebhookSuccess();
        }
    });
}

function showWebhookSuccess() {
    $('#webhookStatus').html(
        '<span style="color:#2e844a;">&#10003; Done! Job ID: <strong>' +
        webhookJobId + '</strong></span>'
    );
    $('#btnNext').prop('disabled', false);

    // Move to step 2 after a brief pause
    setTimeout(function () { goToStep(2); }, 600);
}

// ─── Screen 2 – Entry DE field names ─────────────────────────────────

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

// ─── Screen 3 – Preview top 2 records ────────────────────────────────

function fetchPreviewRecords() {
    if (!entryDeKey) {
        $('#previewStatus').html(
            '<span style="color:#b26500;">No Entry DE key detected from the journey schema.</span>'
        );
        return;
    }

    $('#previewStatus').html(
        '<span style="color:#888;">Resolving Entry DE and fetching top 2 records…</span>'
    );

    $.ajax({
        url: BASE_URL + '/de/entry-records?eventDefKey=' + encodeURIComponent(entryDeKey),
        method: 'GET',
        timeout: 15000,
        success: function (res) {
            if (res.success && res.records && res.records.length > 0) {
                renderPreviewTable(res.records);
                $('#previewStatus').html(
                    '<span style="color:#2e844a;">Showing top ' + res.records.length +
                    ' record(s) from the Entry DE</span>'
                );
            } else if (res.error) {
                $('#previewStatus').html(
                    '<span style="color:#c23934;">Server error: ' + res.error + '</span>'
                );
            } else {
                $('#previewStatus').html(
                    '<span style="color:#b26500;">No records found in the Entry DE.</span>'
                );
            }
        },
        error: function (xhr) {
            var msg = 'Failed to fetch records.';
            try {
                var body = JSON.parse(xhr.responseText);
                if (body.error) msg += ' ' + body.error;
            } catch(e) {}
            $('#previewStatus').html(
                '<span style="color:#c23934;">' + msg + '</span>'
            );
        }
    });
}

function renderPreviewTable(records) {
    if (!records || records.length === 0) return;

    var fieldSet = {};
    records.forEach(function (r) {
        Object.keys(r).forEach(function (k) { fieldSet[k] = true; });
    });
    var fields = Object.keys(fieldSet);

    var headerHtml = '<thead><tr>';
    fields.forEach(function (f) { headerHtml += '<th>' + f + '</th>'; });
    headerHtml += '</tr></thead>';

    var bodyHtml = '<tbody>';
    records.forEach(function (record) {
        bodyHtml += '<tr>';
        fields.forEach(function (f) {
            bodyHtml += '<td>' + (record[f] != null ? record[f] : '') + '</td>';
        });
        bodyHtml += '</tr>';
    });
    bodyHtml += '</tbody>';

    $('#previewRecordsTable').html(headerHtml + bodyHtml);
}

function showJobIdSummary() {
    if (webhookJobId) {
        $('#jobIdSummary').html('<strong>Webhook Job ID:</strong> ' + webhookJobId);
    }
}

// ─── Save Activity (final step → Postmonger) ────────────────────────

function saveActivity() {
    payload.arguments         = payload.arguments         || {};
    payload.arguments.execute = payload.arguments.execute || {};
    payload.metaData          = payload.metaData          || {};

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

// ─── Hydrate from previously saved payload ───────────────────────────

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
