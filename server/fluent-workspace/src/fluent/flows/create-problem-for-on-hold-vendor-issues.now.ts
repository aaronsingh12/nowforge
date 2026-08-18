// nowforge-spec: 0a8c04f64afd4b31
import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'

Flow(
    {
        $id: Now.ID['vhp_flow'],
        name: 'Create Problem for On Hold Vendor Issues',
        description: 'When an incident is updated to On Hold with Awaiting Vendor, create a linked problem.',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.updated,
        { $id: Now.ID['vhp_trigger'] },
        {
            table: 'incident',
            condition: 'state=3^hold_reason=4',
            run_flow_in: 'background',
            trigger_strategy: 'unique_changes',
        }
    ),
    (params) => {
        // Look up the Hardware group to get manager (may be empty)
        const hwGroup = wfa.action(
            action.core.lookUpRecord,
            { $id: Now.ID['vhp_hw_group_lookup'] },
            {
                table: 'sys_user_group',
                conditions: `sys_id=8a5055c9c61122780043563ef53438e3`,
            }
        )

        // Create the Problem record
        const prob = wfa.action(
            action.core.createRecord,
            { $id: Now.ID['vhp_create_problem'] },
            {
                table_name: 'problem',
                values: TemplateValue({
                    short_description: `Vendor issue: ${wfa.dataPill(params.trigger.current.short_description, 'string')}`,
                    assignment_group: '8a5055c9c61122780043563ef53438e3',
                }),
            }
        )

        // If incident priority is Critical (1), set Problem Assigned to Hardware manager
        wfa.flowLogic.if(
            {
                $id: Now.ID['vhp_if_critical'],
                condition: `${wfa.dataPill(params.trigger.current.priority, 'integer')}=1`,
            },
            () => {
                wfa.action(
                    action.core.updateRecord,
                    { $id: Now.ID['vhp_update_problem_assigned_to'] },
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

        // Link Incident to Problem
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['vhp_link_incident_problem'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({
                    problem: wfa.dataPill(prob.record, 'reference'),
                }),
            }
        )

        // Add work note with Problem number
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['vhp_add_work_note'] },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({
                    work_notes: wfa.dataPill(prob.Record.number, 'string'),
                }),
            }
        )
    }
)