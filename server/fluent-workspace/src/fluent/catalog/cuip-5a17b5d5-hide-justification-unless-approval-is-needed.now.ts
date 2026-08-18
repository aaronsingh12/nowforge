import { CatalogUiPolicy } from '@servicenow/sdk/core'

// Managed by NowForge. Generated from the policy builder — edit it there.
// nowforge-policy: cuip-5a17b5d5-hide-justification-unless-approval-is-needed
CatalogUiPolicy({
    $id: Now.ID["cuip_5a17b5d5_hide_justification_unless_approval_is_needed"],
    shortDescription: "Hide justification unless approval is needed",
    catalogItem: "5a17b5d583bacf10b939cc65eeaad37b",
    appliesTo: 'item',
    catalogCondition: "IO:2217fd5183bacf10b939cc65eeaad317=false^EQ",
    active: true,
    onLoad: true,
    reverseIfFalse: true,
    // 'all' is ui_type 10 — the SDK's own default, and unambiguous across every
    // rendering surface. Not a workaround: a policy at ui_type 0 was measured
    // working on the Service Portal too (see the note at the top of this file).
    runScriptsInUiType: 'all',
    order: 100,
    actions: [
        {
            variableName: "3617b5d583bacf10b939cc65eeaad3f5",
            variable: "justification",
            visible: false,
            order: 100,
        },
    ],
})
