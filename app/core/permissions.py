from enum import StrEnum

from app.models.company_member import CompanyRole


class Permission(StrEnum):
    dashboard_read = "dashboard:read"
    transactions_read = "transactions:read"
    invoices_read = "invoices:read"
    digests_read = "digests:read"
    anomalies_read = "anomalies:read"
    chat_ask = "chat:ask"
    invoice_upload = "invoice:upload"
    invoice_review = "invoice:review"
    invoices_manage = "invoices:manage"
    transaction_categorize = "transaction:categorize"
    transaction_manage = "transaction:manage"
    categories_manage = "categories:manage"
    budgets_manage = "budgets:manage"
    company_edit = "company:edit"
    members_manage = "members:manage"
    company_currency = "company:currency"
    company_delete = "company:delete"
    owner_grant = "owner:grant"


READ_PERMISSIONS = frozenset(
    {
        Permission.dashboard_read,
        Permission.transactions_read,
        Permission.invoices_read,
        Permission.digests_read,
        Permission.anomalies_read,
        Permission.chat_ask,
    }
)

ROLE_PERMISSIONS: dict[CompanyRole, frozenset[Permission]] = {
    CompanyRole.viewer: READ_PERMISSIONS,
    CompanyRole.member: READ_PERMISSIONS
    | frozenset(
        {
            Permission.invoice_upload,
            Permission.invoice_review,
            Permission.transaction_categorize,
        }
    ),
    CompanyRole.accountant: READ_PERMISSIONS
    | frozenset(
        {
            Permission.invoice_upload,
            Permission.invoice_review,
            Permission.invoices_manage,
            Permission.transaction_categorize,
            Permission.transaction_manage,
            Permission.categories_manage,
            Permission.budgets_manage,
            Permission.company_edit,
            Permission.members_manage,
        }
    ),
    CompanyRole.owner: frozenset(Permission)
    | READ_PERMISSIONS,
}


def permissions_for_role(role: CompanyRole | str) -> list[str]:
    return sorted(permission.value for permission in ROLE_PERMISSIONS[CompanyRole(role)])


def role_can_grant(actor_role: CompanyRole, target_role: CompanyRole) -> bool:
    if actor_role == CompanyRole.owner:
        return True
    if actor_role == CompanyRole.accountant:
        return target_role in {
            CompanyRole.accountant,
            CompanyRole.member,
            CompanyRole.viewer,
        }
    return False
