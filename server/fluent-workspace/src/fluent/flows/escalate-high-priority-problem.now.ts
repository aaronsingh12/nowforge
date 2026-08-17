import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
    {
        $id: Now.ID['escalate_high_priority_problem'],
        name: 'Escalate High Priority Problem',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['trigger'] },
        {
            table: 'problem',
            condition: 'priority=1',
            run_flow_in: 'background',
        }
    ),
    (params) => {
        wfa.action(action.core.updateRecord, { $id: Now.ID['update'] }, {
            table_name: 'problem',
            record: wfa.dataPill(params.trigger.current, 'reference'),
            values: TemplateValue({
                work_notes: 'NowForge escalated it',
            }),
        })

        wfa.action(action.core.log, { $id: Now.ID['log'] }, {
            log_level: 'info',
            log_message: `Problem ${wfa.dataPill(params.trigger.current.number, 'string')}`,
        })
    }
)