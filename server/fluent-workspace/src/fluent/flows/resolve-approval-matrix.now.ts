// nowforge-spec: 1e7e0c35402cc1cc
import { Subflow } from '@servicenow/sdk/automation'

export const resolveApprovalMatrix = Subflow(
    {
        $id: Now.ID['ramm_resolve_approval_matrix'],
        name: 'Resolve Approval Matrix',
        description: 'Resolves the approval matrix for a given context.',
        runAs: 'system',
    },
    () => {
        // No inputs or outputs defined for this subflow.
    }
)