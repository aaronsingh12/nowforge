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
    // 'all' is ui_type 10. The platform's own default is Desktop, which is why
    // a policy can pass a test on the classic form and do nothing on /sp.
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
