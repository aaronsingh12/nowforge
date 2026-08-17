import { Flow, wfa, action, trigger } from '@servicenow/sdk/automation'
import { notifyManager } from './notify-manager.now'

/**
 * UC1 - "P1 Network Escalation"
 *
 * On a P1 incident created against the Network group:
 *   1. look up the group's manager
 *   2. call the UC2 subflow to notify them
 *   3. add a work note
 *   4. if assigned_to is empty, assign it to the manager
 *
 * The trigger matches the group by name (dot-walked encoded query) rather than
 * a hardcoded sys_id, so the flow stays portable across instances.
 */
Flow(
    {
        $id: Now.ID['p1_network_escalation_flow'],
        name: 'P1 Network Escalation',
        description: 'Escalates P1 incidents raised against the Network group to the group manager.',
        runAs: 'system',
    },
    wfa.trigger(
        trigger.record.created,
        { $id: Now.ID['p1ne_trigger'], annotation: 'P1 incident created for the Network group' },
        {
            table: 'incident',
            condition: 'priority=1^assignment_group.name=Network',
            run_flow_in: 'background',
        }
    ),
    (params) => {
        // 1. Look up the assignment group so we can reach its manager.
        const group = wfa.action(
            action.core.lookUpRecord,
            { $id: Now.ID['p1ne_lookup_group'], annotation: 'Load the assignment group' },
            {
                table: 'sys_user_group',
                conditions: `sys_id=${wfa.dataPill(params.trigger.current.assignment_group, 'string')}`,
            }
        )

        // 2. Delegate notification to the reusable subflow (UC2).
        wfa.subflow(
            notifyManager,
            { $id: Now.ID['p1ne_call_notify_manager'], annotation: 'Notify the Network group manager' },
            {
                taskTable: 'incident',
                taskSysId: wfa.dataPill(params.trigger.current.sys_id, 'string'),
                message: 'P1 escalation',
                waitForCompletion: true,
            }
        )

        // 3. Leave an audit trail on the incident.
        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['p1ne_work_note'], annotation: 'Add escalation work note' },
            {
                table_name: 'incident',
                record: wfa.dataPill(params.trigger.current, 'reference'),
                values: TemplateValue({
                    work_notes: 'P1 Network Escalation: the Network group manager has been notified.',
                }),
            }
        )

        // 4. Fall back to the manager as assignee when nobody is assigned yet.
        wfa.flowLogic.if(
            {
                $id: Now.ID['p1ne_unassigned'],
                label: 'Incident is unassigned',
                condition: `${wfa.dataPill(params.trigger.current.assigned_to, 'string')}ISEMPTY`,
            },
            () => {
                wfa.action(
                    action.core.updateRecord,
                    { $id: Now.ID['p1ne_assign_manager'], annotation: 'Assign to the group manager' },
                    {
                        table_name: 'incident',
                        record: wfa.dataPill(params.trigger.current, 'reference'),
                        values: TemplateValue({
                            assigned_to: wfa.dataPill(group.Record.manager, 'reference'),
                        }),
                    }
                )
            }
        )
    }
)
