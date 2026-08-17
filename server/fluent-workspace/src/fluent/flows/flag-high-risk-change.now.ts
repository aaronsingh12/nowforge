import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
    {
        $id: Now.ID['flag_high_risk_change_flow'],
        name: 'Flag high risk change',
        description: 'When a change request is created with risk set to High, add a work note and log the change number.',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['flag_high_risk_trigger'] },
        {
            table: 'change_request',
            condition: 'risk=2',
            run_flow_in: 'background',
        }
    ),
    (params) => {
        wfa.action(action.core.updateRecord, { $id: Now.ID['add_work_note'] }, {
            table_name: 'change_request',
            record: wfa.dataPill(params.trigger.current, 'reference'),
            values: TemplateValue({
                work_notes: 'NowForge flagged it as high risk',
            }),
        })

        wfa.action(action.core.log, { $id: Now.ID['log_change_number'] }, {
            log_level: 'info',
            log_message: `Change ${wfa.dataPill(params.trigger.current.number, 'string')} flagged as high risk`,
        })
    }
)