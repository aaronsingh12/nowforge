// nowforge-spec: 3a067b0b036de36e
import { Subflow, wfa, action } from '@servicenow/sdk/automation'
import { ReferenceColumn, StringColumn } from '@servicenow/sdk/core'
import { notifyManager } from './escalate-network-p1-incident.now'

export const escalateToDutyManager = Subflow(
    {
        $id: Now.ID['etdm_escalate_to_duty_manager'],
        name: 'Escalate To Duty Manager',
        description: 'Looks up the task assignment group manager, notifies them, and adds a work note.',
        runAs: 'system',
        inputs: {
            task: ReferenceColumn({ label: 'Task', referenceTable: 'task', mandatory: true }),
            message: StringColumn({ label: 'Message', mandatory: true }),
        },
    },
    (params) => {
        wfa.subflow(
            notifyManager,
            { $id: Now.ID['etdm_call_notify_manager'] },
            {
                taskTable: 'task',
                taskSysId: wfa.dataPill(params.inputs.task, 'string'),
                message: wfa.dataPill(params.inputs.message, 'string'),
                waitForCompletion: true,
            }
        )

        wfa.action(
            action.core.updateRecord,
            { $id: Now.ID['etdm_add_work_note'] },
            {
                table_name: 'task',
                record: wfa.dataPill(params.inputs.task, 'reference'),
                values: TemplateValue({
                    work_notes: wfa.dataPill(params.inputs.message, 'string'),
                }),
            }
        )
    }
)