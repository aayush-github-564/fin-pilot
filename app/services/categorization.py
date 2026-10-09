import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category


CATEGORY_RULES: dict[str, str] = {
    # Software & Subscriptions
    "aws": "Software & Subscriptions",
    "amazon web services": "Software & Subscriptions",
    "github": "Software & Subscriptions",
    "google workspace": "Software & Subscriptions",
    "notion": "Software & Subscriptions",
    "slack": "Software & Subscriptions",
    "zoom": "Software & Subscriptions",
    "mailchimp": "Software & Subscriptions",
    "quickbooks": "Software & Subscriptions",
    # Rent & Utilities
    "wework": "Rent & Utilities",
    "rent": "Rent & Utilities",
    "electric": "Rent & Utilities",
    "comcast": "Rent & Utilities",
    "spectrum": "Rent & Utilities",
    "internet": "Rent & Utilities",
    # Payroll & Contractors
    "payroll": "Payroll & Contractors",
    "adp": "Payroll & Contractors",
    "gusto": "Payroll & Contractors",
    "upwork": "Payroll & Contractors",
    "fiverr": "Payroll & Contractors",
    # Office & Equipment
    "staples": "Office & Equipment",
    "amzn mktp": "Office & Equipment",
    "dell": "Office & Equipment",
    "best buy": "Office & Equipment",
    # Bank & Processing Fees
    "stripe": "Bank & Processing Fees",
    "paypal": "Bank & Processing Fees",
    "wire transfer": "Bank & Processing Fees",
    "service charge": "Bank & Processing Fees",
    # Travel
    "airlines": "Travel",
    "delta air": "Travel",
    "marriott": "Travel",
    "hotel": "Travel",
    "uber": "Travel",
    "hertz": "Travel",
    "rent a car": "Travel",
    # Professional Services
    "legalzoom": "Professional Services",
    "cpa": "Professional Services",
    "attorney": "Professional Services",
    "consulting": "Professional Services",
    # Marketing & Advertising
    "google ads": "Marketing & Advertising",
    "facebook ads": "Marketing & Advertising",
    "meta ads": "Marketing & Advertising",
    # Food & Dining (still relevant — client meals, team lunches)
    "cafe": "Food & Dining",
    "restaurant": "Food & Dining",
    "starbucks": "Food & Dining",
}


def match_category(description: str | None) -> str | None:
    """
    Attempts to match a transaction description against known keyword
    rules. Returns the matched category name, or None if nothing matches
    (meaning this transaction is a candidate for the LLM fallback later).
    """
    if not description:
        return None

    text = description.lower()
    for keyword, category_name in CATEGORY_RULES.items():
        if keyword in text:
            return category_name

    return None


async def resolve_category_id(
    description: str | None, db: AsyncSession
) -> "uuid.UUID | None":
    """
    Runs rule-based matching on a description, then looks up the
    corresponding global default Category row and returns its id.
    Returns None if no rule matched (candidate for LLM fallback later)
    or if the matched category name somehow isn't seeded yet.
    """
    category_name = match_category(description)
    if category_name is None:
        return None

    result = await db.execute(
        select(Category).where(
            Category.name == category_name, Category.company_id.is_(None)
        )
    )
    category = result.scalar_one_or_none()
    return category.id if category else None
