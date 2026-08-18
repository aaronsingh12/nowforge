// nowforge-spec: 0a8c04f64afd4b31
import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
    {
        $id: Now.ID['cphv_flow'],
        name: 'Create Problem for On Hold Vendor Incident',
        description: 'When an incident is updated to On Hold with hold reason Awaiting Vendor, create a linked problem and add a work note.',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.updated,
        { $id: Now.ID['cphv_trigger'] },
        {
            table: 'incident',
            condition: 'incident_state=3^hold_reason=4',
            run_flow_in: 'background',
        }
    ),
    (params) => {
        const hwGroup = wfa.action(
            action.core.lookUpRecord,
            { $id: Now.ID['cphv_hw_lookup'] },
            {
                table: 'sys_user_group',
                conditions: `name=Hardware group`,
            }
        )

        const prob = wfa.action(
            action.core.createRecord,
            { $id: Now.ID['cphv_create_problem'] },
            {
                table_name: 'problem',
                values: TemplateValue({
                    short_description: `Vendor issue: ${wfa.dataPill(params.trigger.current.short_description, 'string')}`,
                    assignment_group: wfa.dataPill(hwGroup.Record, 'reference'),
                }),
            }
        )

        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['cphv_update_incident_problem'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({
                    problem: wfa.dataPill(prob.record, 'reference'),
                }),
            }
        )

        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['cphv_update_incident_worknote'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({
                    work_notes: `Problem ${wfa.dataPill(prob.record.number, 'string')} created`,
                }),
            }
        )

        wfa.flowLogic.if(
            {
                $id: Now.ID['cphv_if_critical'],
                condition: `${wfa.dataPill(params.trigger.current.priority, 'integer')}=1`,
            },
            () => {
                wfa.action(
                    action.core.updateRecord,
                    { $id: Now.ID['cphv_update_problem_assigned'] },
                    {
                        table_name: 'problem',
                        record: wfa.dataPill(prob.record, 'reference'),
                        values: TemplateValue({
                            assigned_to: wfa.dataPill(hwGroup.Record.manager, 'reference'),
                        }),
                    }
                )
            }
        )
    }
)