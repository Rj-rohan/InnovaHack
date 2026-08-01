"""Proves the world is generated, not scripted: run it twice and compare."""
import asyncio, sys, logging
sys.path.insert(0, ".")
logging.basicConfig(level=logging.WARNING)
from agent.generator import generate_world
from agent.tools import counterparties

async def main():
    runs = []
    for n in (1, 2):
        w = await generate_world(counterparties(), per_tx_cap_usdc=40.0, rolling_cap_usdc=100.0)
        runs.append(w)
        print(f"\n--- run {n} ---")
        print("approved:", ", ".join(v.name for v in w.approved_vendors), "| unapproved:", w.unapproved_vendor.name)
        for i in w.invoices:
            print(f"  {i.invoice_id:12} {i.category:15} {i.amount_usdc:>9.2f}  {i.vendor[:28]:28} po={i.po_ref}")
        print("  categories:", sorted(w.categories()))

    a, b = runs
    ids_a = {i.invoice_id for i in a.invoices}
    ids_b = {i.invoice_id for i in b.invoices}
    names_a = {v.name for v in a.all_vendors()}
    names_b = {v.name for v in b.all_vendors()}
    print(f"\ninvoice ids overlap : {sorted(ids_a & ids_b) or 'NONE'}")
    print(f"vendor names overlap: {sorted(names_a & names_b) or 'NONE'}")
    assert ids_a != ids_b or names_a != names_b, "two runs produced identical data — still a fixture"
    print("\nGENERATED, NOT SCRIPTED")

asyncio.run(main())
