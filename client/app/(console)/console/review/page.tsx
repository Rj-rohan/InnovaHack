"use client";

import { ReviewQueue } from "@/components/agent/review-queue";
import { useConsole } from "@/components/console-data";
import { useAgent } from "@/lib/use-agent";

/**
 * Invoices the agent referred to a human.
 *
 * Read model comes from the database (live via the dashboard's SSE `review` events); decisions go
 * back to the agent service, which owns the queue. One writer, no two-way sync.
 */
export default function ReviewPage() {
  const { data } = useConsole();
  const agent = useAgent();

  const pending = data.reviewItems.filter((item) => item.status === "pending").length;

  return (
    <div className="mx-auto flex max-w-384 flex-col gap-8">
      <header>
        <h1 className="heading text-panel text-placard">Review</h1>
        <p className="measure mt-2 text-body text-placard/65">
          {pending > 0
            ? `${pending} ${pending === 1 ? "invoice is" : "invoices are"} waiting on you.`
            : "Invoices the agent was unsure about arrive here."}
        </p>
      </header>

      <ReviewQueue items={data.reviewItems} agent={agent} onResolved={data.refresh} />
    </div>
  );
}
