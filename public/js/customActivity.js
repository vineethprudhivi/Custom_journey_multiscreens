define(['postmonger'], function (Postmonger) {
    'use strict';

    var connection = new Postmonger.Session();
    var payload = {};
    var schema = [];

    var TARGET_FIELDS = ['id', 'fname', 'lname', 'email'];

    $(window).ready(onRender);
    connection.on('initActivity', initialize);
    connection.on('clickedNext', save);

    function onRender() {
        connection.trigger('ready');
        connection.trigger('requestTokens');
        connection.trigger('requestEndpoints');
        connection.trigger('requestSchema');
    }

    function initialize(data) {
        if (data) {
            payload = data;
        }

        connection.on('requestedSchema', function (data) {
            schema = (data && data.schema) ? data.schema : [];
            populateSourceFieldDropdowns(schema);
            hydrateFromExistingPayload();
        });

        connection.trigger('requestSchema');
    }

    function save() {
        var targetDEKey = ($('#target-de-key').val() || '').trim();

        var values = {};
        TARGET_FIELDS.forEach(function (targetField) {
            var selectedSchemaKey = $(`#map-${targetField}`).val();
            values[targetField] = selectedSchemaKey ? `{{${selectedSchemaKey}}}` : null;
        });

        payload.arguments.execute.inArguments = [
            {
                targetDEKey: targetDEKey || null,
                values: values
            }
        ];

        payload.metaData.isConfigured = true;
        connection.trigger('updateActivity', payload);
    }

    function populateSourceFieldDropdowns(schema) {
        var keys = (schema || [])
            .map(function (s) { return s && s.key; })
            .filter(Boolean);

        TARGET_FIELDS.forEach(function (targetField) {
            var $select = $(`#map-${targetField}`);
            if ($select.length === 0) {
                return;
            }

            // Preserve the initial placeholder option.
            $select.find('option').not(':first').remove();

            keys.forEach(function (key) {
                $select.append($('<option>', { value: key, text: key }));
            });
        });
    }

    function hydrateFromExistingPayload() {
        var existing = payload && payload.arguments && payload.arguments.execute && payload.arguments.execute.inArguments;
        if (!existing || existing.length === 0) {
            return;
        }

        var args = existing[0] || {};
        if (args.targetDEKey) {
            $('#target-de-key').val(args.targetDEKey);
        }

        var values = args.values || {};
        TARGET_FIELDS.forEach(function (targetField) {
            var v = values[targetField];
            if (!v || typeof v !== 'string') {
                return;
            }

            // values are stored as "{{Schema.Key}}"; convert back to Schema.Key
            var m = v.match(/^\{\{(.+)\}\}$/);
            var schemaKey = m ? m[1] : null;
            if (schemaKey) {
                $(`#map-${targetField}`).val(schemaKey);
            }
        });
    }
});
