# Due is a running balance, not month-slot allocation

Members' payments are recorded as plain money-in entries with a Credit Date (when the amount hit the bank); they are never allocated to specific months. A member's Due is one number: total billed (shares × price × months from joining to exit) minus total contributed. Overpayment becomes an Advance that carries forward.

Month-by-month status (the dashboard grid) is derived for display by walking a member's entries chronologically against their monthly bills — it is a projection, not stored data. Waivers and opening dues are handled as Adjustment entries rather than a month-allocation schema. Chosen because the team records money when it lands in the bank, so forcing an admin to pick which month a payment is "for" would be invented bookkeeping; the cost is that per-month history is recomputed rather than stored.
