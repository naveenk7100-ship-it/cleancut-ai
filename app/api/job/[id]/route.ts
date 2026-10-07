import { NextRequest, NextResponse } from "next/server";
import { getJob, subscribeJob } from "@/lib/jobManager";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const jobId = params.id;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // If client requests Server-Sent Events (SSE)
  const acceptHeader = req.headers.get("accept") || "";
  if (acceptHeader.includes("text/event-stream")) {
    const encoder = new TextEncoder();
    let isClosed = false;

    const stream = new ReadableStream({
      start(controller) {
        // Send initial state immediately
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(job)}\n\n`));

        if (job.status === "completed" || job.status === "failed") {
          try {
            controller.close();
          } catch (_) {}
          return;
        }

        const unsubscribe = subscribeJob(jobId, (updatedJob) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(updatedJob)}\n\n`));
            if (updatedJob.status === "completed" || updatedJob.status === "failed") {
              isClosed = true;
              unsubscribe();
              try {
                controller.close();
              } catch (_) {}
            }
          } catch (e) {
            isClosed = true;
            unsubscribe();
          }
        });

        // Safety timeout after 15 minutes
        setTimeout(() => {
          if (!isClosed) {
            isClosed = true;
            unsubscribe();
            try {
              controller.close();
            } catch (e) {}
          }
        }, 15 * 60 * 1000);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Standard JSON response
  return NextResponse.json(job);
}
