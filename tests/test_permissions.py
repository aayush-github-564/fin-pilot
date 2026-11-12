from app.core.permissions import Permission, ROLE_PERMISSIONS
from app.models.company_member import CompanyRole


def test_company_role_permission_matrix() -> None:
    read_permissions = {
        Permission.dashboard_read,
        Permission.transactions_read,
        Permission.invoices_read,
        Permission.digests_read,
        Permission.anomalies_read,
        Permission.chat_ask,
    }
    assert ROLE_PERMISSIONS[CompanyRole.viewer] == read_permissions
    assert ROLE_PERMISSIONS[CompanyRole.member] == read_permissions | {
        Permission.invoice_upload,
        Permission.invoice_review,
        Permission.transaction_categorize,
    }
    assert {
        Permission.members_manage,
        Permission.company_edit,
        Permission.transaction_manage,
        Permission.invoices_manage,
    } <= ROLE_PERMISSIONS[CompanyRole.accountant]
    assert {
        Permission.company_currency,
        Permission.company_delete,
        Permission.owner_grant,
    } <= ROLE_PERMISSIONS[CompanyRole.owner]
