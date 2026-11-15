import os
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import HTTPException


def household_calendar():
    try:
        timezone = os.getenv('HOUSEHOLD_TIMEZONE', 'UTC')
        return datetime.now(ZoneInfo(timezone)).date(), timezone
    except (ValueError, ZoneInfoNotFoundError):
        raise HTTPException(503, 'Household timezone is not configured correctly.') from None


def dinner_configuration():
    try:
        return int(os.environ['GROCY_DINNER_SECTION_ID']) if os.getenv('GROCY_DINNER_SECTION_ID') else None
    except ValueError:
        raise HTTPException(503, 'Dinner section is not configured correctly.') from None


def dinner_section(sections, section_id):
    if not isinstance(sections, list) or any(not isinstance(s, dict) for s in sections):
        raise ValueError('Invalid dinner sections')
    if section_id is None:
        matches = [int(s['id']) for s in sections if str(s.get('name') or '').strip().casefold() == 'dinner']
        if len(matches) != 1:
            raise ValueError('Configure a unique dinner section')
        section_id = matches[0]
    # Grocy's built-in unsectioned calendar has no section row.
    if section_id != -1 and not any(int(s['id']) == section_id for s in sections):
        raise ValueError('Dinner section missing')
    return section_id
