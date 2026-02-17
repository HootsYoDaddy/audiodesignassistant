import { getDeveloperPrompt, MODEL } from "@/config/constants";
import { getTools } from "@/lib/tools/tools";
import OpenAI from "openai";

export async function POST(request: Request) {
  try {
    const { messages, toolsState } = await request.json();

    // CHANGED: make tools mutable so we can sanitize file_search vector_store_ids
    let tools = await getTools(toolsState);

    // CHANGED: sanitize tools so we never send null vector_store_ids (prevents 400 error)
    const DEFAULT_VECTOR_STORE_ID = "vs_6993c1e2a5908191889331682f914090";

    tools = (tools ?? [])
      .map((t: any) => {
        if (t?.type !== "file_search") return t;

        const ids = Array.isArray(t.vector_store_ids)
          ? t.vector_store_ids.filter(
              (x: any) => typeof x === "string" && x.trim().length > 0
            )
          : [];

        const finalIds = ids.length ? ids : [DEFAULT_VECTOR_STORE_ID];

        return {
          ...t,
          vector_store_ids: finalIds,
        };
      })
      .filter(
        (t: any) =>
          t?.type !== "file_search" ||
          (Array.isArray(t.vector_store_ids) && t.vector_store_ids.length > 0)
      );

    console.log("Tools:", tools);

    console.log("Received messages:", messages);

    const openai = new OpenAI();

    const events = await openai.responses.create({
      model: MODEL,
      input: messages,
      instructions: getDeveloperPrompt(),
      tools,
      stream: true,
      parallel_tool_calls: false,
    });

    // Create a ReadableStream that emits SSE data
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of events) {
            // Sending all events to the client
            const data = JSON.stringify({
              event: event.type,
              data: event,
            });
            controller.enqueue(`data: ${data}\n\n`);
          }
          // End of stream
          controller.close();
        } catch (error) {
          console.error("Error in streaming loop:", error);
          controller.error(error);
        }
      },
    });

    // Return the ReadableStream as SSE
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Error in POST handler:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500 }
    );
  }
}
