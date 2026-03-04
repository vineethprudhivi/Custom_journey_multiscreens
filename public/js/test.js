// 1. Initialize Postmonger session at the top
var connection = new Postmonger.Session();
var payload = {};
var schema = [];

// 2. Add the window.ready logic to break the loading spinner
$(window).ready(function() {
    connection.trigger('ready'); // CRITICAL: This stops the loading spinner
    connection.trigger('requestSchema'); // Request schema on initialization
});

// 3. Your existing initActivity logic
connection.on('initActivity', function(data) {
    if (data) { 
        payload = data; 
    }
    // Hydrate existing values if activity was already configured
    hydrateFromExistingPayload();
});

// 4. Handle requestedSchema to get field names
connection.on('requestedSchema', function (data) {
    // Validate that schema data exists
    if (!data || !data.schema) {
        console.warn('No schema data received');
        return;
    }
    
    schema = data.schema;
    
    // Populate field checkboxes
    var $fieldSelection = $('#fieldSelection');
    $fieldSelection.empty();
    
    schema.forEach(function(field) {
        if (!field || !field.key) {
            return;
        }
        
        var fieldName = field.name || field.key;
        var checkbox = $('<div style="margin-bottom: 8px;">' +
            '<label style="cursor: pointer;">' +
            '<input type="checkbox" class="field-checkbox" value="' + field.key + '" style="margin-right: 8px;">' +
            fieldName +
            '</label>' +
            '</div>');
        
        $fieldSelection.append(checkbox);
    });
    
    // Populate upsert key dropdown
    var $upsertKey = $('#upsertKey');
    $upsertKey.find('option').not(':first').remove();
    
    schema.forEach(function(field) {
        if (!field || !field.key) {
            return;
        }
        
        $upsertKey.append($('<option>', {
            value: field.key,
            text: field.name || field.key
        }));
    });
    
    // Hydrate after populating fields
    hydrateFromExistingPayload();
});

function save() {
    var destDE = ($('#destinationDE').val() || '').trim();
    var upsertKey = $('#upsertKey').val();
    
    // Get all selected fields
    var selectedFields = {};
    $('.field-checkbox:checked').each(function() {
        var fieldKey = $(this).val(); // e.g., "Event.DEKey.email"
        var fieldName = $(this).parent().text().trim();
        
        // Extract the actual field name from the schema key
        // If fieldKey is "Event.DEKey.email", extract "email"
        var parts = fieldKey.split('.');
        var actualFieldName = parts[parts.length - 1];
        
        // Store as actualFieldName: "{{Event.DEKey.FieldName}}"
        selectedFields[actualFieldName] = '{{' + fieldKey + '}}';
    });
    
    // Extract the upsert key field name from its schema key
    var upsertKeyName = upsertKey;
    if (upsertKey && upsertKey.indexOf('.') !== -1) {
        var parts = upsertKey.split('.');
        upsertKeyName = parts[parts.length - 1];
    }

    // Initialize payload structure if not exists
    payload.arguments = payload.arguments || {};
    payload.arguments.execute = payload.arguments.execute || {};
    payload.metaData = payload.metaData || {};

    // Build inArguments with field mappings
    payload.arguments.execute.inArguments = [{
        destinationDE: destDE || null,
        upsertKey: upsertKeyName || null,
        fieldMappings: selectedFields
    }];
    
    payload.metaData.isConfigured = true;
    connection.trigger('updateActivity', payload);
}

function hydrateFromExistingPayload() {
    var existing = payload && payload.arguments && payload.arguments.execute && payload.arguments.execute.inArguments;
    if (!existing || existing.length === 0) {
        return;
    }

    var args = existing[0] || {};
    
    // Restore destination DE
    if (args.destinationDE) {
        $('#destinationDE').val(args.destinationDE);
    }
    
    // Restore upsert key - need to find the matching schema key
    if (args.upsertKey && schema.length > 0) {
        schema.forEach(function(field) {
            if (!field || !field.key) return;
            var parts = field.key.split('.');
            var fieldName = parts[parts.length - 1];
            if (fieldName === args.upsertKey) {
                $('#upsertKey').val(field.key);
            }
        });
    }

    // Restore selected fields
    if (args.fieldMappings && typeof args.fieldMappings === 'object') {
        $('.field-checkbox').each(function() {
            var fieldKey = $(this).val();
            var parts = fieldKey.split('.');
            var fieldName = parts[parts.length - 1];
            
            // Check if this field was previously selected
            if (args.fieldMappings.hasOwnProperty(fieldName)) {
                $(this).prop('checked', true);
            }
        });
    }
}

// 5. Connect the Salesforce 'Next' button to your save function
connection.on('clickedNext', save);
