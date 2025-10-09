import { streamText, convertToModelMessages } from "ai";
import { researchTools } from "@/lib/tools";
import { HealthcareUIMessage } from "@/lib/types";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { createOllama, ollama } from "ollama-ai-provider-v2";
import { checkAnonymousRateLimit, incrementRateLimit } from "@/lib/rate-limit";
import { createClient } from "@supabase/supabase-js";
import { checkUserRateLimit } from "@/lib/rate-limit";
import { validateAccess } from "@/lib/polar-access-validation";
import { getPolarTrackedModel } from "@/lib/polar-llm-strategy";

// Allow streaming responses up to 120 seconds
export const maxDuration = 180;

export async function POST(req: Request) {
  try {
    let requestData;
    try {
      requestData = await req.json();
    } catch (jsonError) {
      console.error("[Chat API] JSON parsing error:", jsonError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const {
      messages,
      sessionId,
      attachments,
    }: {
      messages: HealthcareUIMessage[];
      sessionId?: string;
      attachments?: any[];
    } = requestData;
    console.log(
      "[Chat API] Incoming messages:",
      JSON.stringify(messages, null, 2)
    );

    // If attachments are present, decode and append them to the last user message as AI SDK parts
    try {
      if (Array.isArray(messages) && messages.length > 0) {
        const lastIdx = messages.map((m: any) => m.role).lastIndexOf("user");
        const targetIdx = lastIdx >= 0 ? lastIdx : messages.length - 1;
        const target = messages[targetIdx] as any;

        const normalizeMessageParts = () => {
          if (Array.isArray(target.parts)) {
            return target.parts;
          }
          if (Array.isArray(target.content)) {
            const cloned = (target.content as any[]).map((part: any) =>
              part && typeof part === "object" ? { ...part } : part
            );
            target.parts = cloned;
            delete target.content;
            return target.parts;
          }
          if (typeof target.content === "string") {
            target.parts = [{ type: "text", text: target.content }];
            delete target.content;
            return target.parts;
          }
          if (typeof target.text === "string") {
            target.parts = [{ type: "text", text: target.text }];
            delete target.text;
            return target.parts;
          }
          target.parts = Array.isArray(target.parts) ? target.parts : [];
          return target.parts;
        };

        const hasEmbeddedBase64 =
          (Array.isArray(target.parts) &&
            target.parts.some(
              (part: any) =>
                part &&
                typeof part === "object" &&
                typeof part.dataBase64 === "string" &&
                part.dataBase64.length > 0
            )) ||
          (Array.isArray(target.content) &&
            target.content.some(
              (part: any) =>
                part &&
                typeof part === "object" &&
                typeof part.dataBase64 === "string" &&
                part.dataBase64.length > 0
            ));

        let embeddedConverted = false;

        if (
          (Array.isArray(attachments) && attachments.length > 0) ||
          hasEmbeddedBase64
        ) {
          const partsArray = normalizeMessageParts();

          if (Array.isArray(partsArray)) {
            const convertedParts = partsArray.map((part: any) => {
              if (
                part &&
                typeof part === "object" &&
                typeof part.dataBase64 === "string" &&
                part.dataBase64.length > 0
              ) {
                const data = Buffer.from(part.dataBase64, "base64");
                embeddedConverted = true;

                if (part.type === "image") {
                  const { dataBase64, mimeType, mediaType, ...rest } = part;
                  return {
                    ...rest,
                    type: "image",
                    image: data,
                    mimeType: mimeType || mediaType || "image/png",
                  };
                }

                if (part.type === "file") {
                  const { dataBase64, ...rest } = part;
                  return {
                    ...rest,
                    type: "file",
                    data,
                    mediaType: part.mediaType || "application/octet-stream",
                    filename: part.filename || part.name,
                  };
                }
              }
              return part;
            });

            target.parts = convertedParts.map((part: any) => {
              if (part && typeof part === "object" && "dataBase64" in part) {
                const { dataBase64, ...rest } = part;
                return rest;
              }
              return part;
            });
          }
        }

        if (
          Array.isArray(attachments) &&
          attachments.length > 0 &&
          !embeddedConverted
        ) {
          const decodedParts = attachments.map((att: any) => {
            const data = Buffer.from(att.dataBase64 || "", "base64");
            if (att.kind === "image") {
              return {
                type: "image",
                image: data,
                mimeType: att.mediaType || "image/png",
              };
            }
            return {
              type: "file",
              data,
              mediaType: att.mediaType || "application/octet-stream",
              filename: att.name || undefined,
            };
          });

          if (Array.isArray(target.parts)) {
            target.parts = [...target.parts, ...decodedParts];
          } else if (typeof target.content === "string") {
            target.parts = [
              { type: "text", text: target.content },
              ...decodedParts,
            ];
            delete target.content;
          } else if (Array.isArray(target.content)) {
            target.content = [...target.content, ...decodedParts];
          } else {
            target.parts = decodedParts;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to merge attachments into message", e);
    }

    // Determine if this is a user-initiated message (should count towards rate limit)
    // ONLY increment for the very first user message in a conversation
    // All tool calls, continuations, and follow-ups should NOT increment
    const lastMessage = messages[messages.length - 1];
    const isUserMessage = lastMessage?.role === "user";
    const userMessageCount = messages.filter((m) => m.role === "user").length;

    // Simple rule: Only increment if this is a user message AND it's the first user message
    const isUserInitiated = isUserMessage && userMessageCount === 1;

    console.log("[Chat API] Rate limit check:", {
      isUserMessage,
      userMessageCount,
      isUserInitiated,
      totalMessages: messages.length,
    });

    // Get authenticated user using anon key
    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: req.headers.get("Authorization") || "",
          },
        },
      }
    );

    // Create service role client for database operations
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const {
      data: { user },
    } = await supabaseAnon.auth.getUser();

    // Check app mode and configure accordingly
    const isDevelopment = process.env.NEXT_PUBLIC_APP_MODE === "development";
    console.log(
      "[Chat API] App mode:",
      isDevelopment ? "development" : "production"
    );
    console.log("[Chat API] Authenticated user:", user?.id || "anonymous");

    // Validate access for authenticated users (simplified validation)
    if (user && !isDevelopment) {
      const accessValidation = await validateAccess(user.id);

      if (
        !accessValidation.hasAccess &&
        accessValidation.requiresPaymentSetup
      ) {
        console.log("[Chat API] Access validation failed - payment required");
        return new Response(
          JSON.stringify({
            error: "PAYMENT_REQUIRED",
            message: "Payment method setup required",
            tier: accessValidation.tier,
            action: "setup_payment",
          }),
          { status: 402, headers: { "Content-Type": "application/json" } }
        );
      }

      if (accessValidation.hasAccess) {
        console.log(
          "[Chat API] Access validated for tier:",
          accessValidation.tier
        );
      }
    }

    // Check rate limit for user-initiated messages
    if (isUserInitiated && !isDevelopment) {
      if (!user) {
        // Fall back to anonymous rate limiting for non-authenticated users
        const rateLimitStatus = await checkAnonymousRateLimit();
        console.log("[Chat API] Anonymous rate limit status:", rateLimitStatus);

        if (!rateLimitStatus.allowed) {
          console.log("[Chat API] Anonymous rate limit exceeded");
          return new Response(
            JSON.stringify({
              error: "RATE_LIMIT_EXCEEDED",
              message:
                "You have exceeded your daily limit of 5 queries. Sign up to continue.",
              resetTime: rateLimitStatus.resetTime.toISOString(),
              remaining: rateLimitStatus.remaining,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "X-RateLimit-Limit": rateLimitStatus.limit.toString(),
                "X-RateLimit-Remaining": rateLimitStatus.remaining.toString(),
                "X-RateLimit-Reset": rateLimitStatus.resetTime.toISOString(),
              },
            }
          );
        }
      } else {
        // Check user-based rate limits
        const rateLimitResult = await checkUserRateLimit(user.id);
        console.log("[Chat API] User rate limit status:", rateLimitResult);

        if (!rateLimitResult.allowed) {
          return new Response(
            JSON.stringify({
              error: "RATE_LIMIT_EXCEEDED",
              message: "Daily query limit reached. Upgrade to continue.",
              resetTime: rateLimitResult.resetTime.toISOString(),
              tier: rateLimitResult.tier,
            }),
            {
              status: 429,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      }
    } else if (isUserInitiated && isDevelopment) {
      console.log("[Chat API] Development mode: Rate limiting disabled");
    }

    // Detect available API keys and select provider/tools accordingly
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    const ollamaBaseUrl =
      process.env.OLLAMA_BASE_URL || "http://localhost:11434";

    let selectedModel: any;
    let modelInfo: string;

    if (isDevelopment) {
      // Development mode: Use OpenAI by default, only use Ollama when explicitly requested
      const userPreferredModel = req.headers.get("x-ollama-model");

      if (userPreferredModel) {
        // User explicitly wants to use Ollama - check if it's available
        try {
          const ollamaResponse = await fetch(`${ollamaBaseUrl}/api/tags`, {
            method: "GET",
            signal: AbortSignal.timeout(3000), // 3 second timeout
          });

          if (ollamaResponse.ok) {
            const data = await ollamaResponse.json();
            const models = data.models || [];

            if (models.some((m: any) => m.name === userPreferredModel)) {
              console.log(
                `[Chat API] Using requested Ollama model: ${userPreferredModel}`
              );

              const ollamaAsOpenAI = createOpenAI({
                baseURL: `${ollamaBaseUrl}/v1`,
                apiKey: "ollama",
              });

              selectedModel = ollamaAsOpenAI.chat(userPreferredModel);
              modelInfo = `Ollama (${userPreferredModel}) - Development Mode`;
            } else {
              throw new Error(
                `Requested model ${userPreferredModel} not found in Ollama`
              );
            }
          } else {
            throw new Error(
              `Ollama API responded with status ${ollamaResponse.status}`
            );
          }
        } catch (error) {
          console.log(
            "[Chat API] Requested Ollama model not available, falling back to OpenAI:",
            error
          );
          selectedModel = hasOpenAIKey ? openai("gpt-5") : "openai/gpt-5";
          modelInfo = hasOpenAIKey
            ? "OpenAI (gpt-5) - Development Mode (Ollama Fallback)"
            : 'Vercel AI Gateway ("gpt-5") - Development Mode (Ollama Fallback)';
        }
      } else {
        // Default to OpenAI in development mode
        selectedModel = hasOpenAIKey ? openai("gpt-5") : "openai/gpt-5";
        modelInfo = hasOpenAIKey
          ? "OpenAI (gpt-5) - Development Mode Default"
          : 'Vercel AI Gateway ("gpt-5") - Development Mode Default';
      }
    } else {
      // Production mode: Use Polar-wrapped OpenAI ONLY for pay-per-use users
      if (user) {
        // Get user subscription tier to determine billing approach
        const { data: userData } = await supabase
          .from("users")
          .select("subscription_tier, subscription_status")
          .eq("id", user.id)
          .single();

        const userTier = userData?.subscription_tier || "free";
        const isActive = userData?.subscription_status === "active";

        // Only use Polar LLM Strategy for pay-per-use users
        if (isActive && userTier === "pay_per_use") {
          selectedModel = getPolarTrackedModel(user.id, "gpt-5");
          modelInfo =
            "OpenAI (gpt-5) - Production Mode (Polar Tracked - Pay-per-use)";
        } else {
          // Unlimited users and free users use regular model (no per-token billing)
          selectedModel = hasOpenAIKey ? openai("gpt-5") : "openai/gpt-5";
          modelInfo = hasOpenAIKey
            ? `OpenAI (gpt-5) - Production Mode (${userTier} tier - Flat Rate)`
            : `Vercel AI Gateway ("gpt-5") - Production Mode (${userTier} tier - Flat Rate)`;
        }
      } else {
        selectedModel = hasOpenAIKey ? openai("gpt-5") : "openai/gpt-5";
        modelInfo = hasOpenAIKey
          ? "OpenAI (gpt-5) - Production Mode (Anonymous)"
          : 'Vercel AI Gateway ("gpt-5") - Production Mode (Anonymous)';
      }
    }

    console.log("[Chat API] Model selected:", modelInfo);

    // No need for usage tracker - Polar LLM Strategy handles everything automatically

    // User tier is already determined above in model selection
    let userTier = "free";
    if (user) {
      const { data: userData } = await supabase
        .from("users")
        .select("subscription_tier")
        .eq("id", user.id)
        .single();
      userTier = userData?.subscription_tier || "free";
      console.log("[Chat API] User tier:", userTier);
    }

    // Save message to database before processing
    if (user && sessionId) {
      console.log(
        "[Chat API] Attempting to save user message to session:",
        sessionId
      );
      console.log("[Chat API] User ID:", user.id);
      console.log("[Chat API] Message to save:", messages[messages.length - 1]);
      console.log("[Chat API] Supabase client created:", !!supabase);
      console.log("[Chat API] Message format check:", {
        hasRole: !!messages[messages.length - 1]?.role,
        hasContent: !!(messages[messages.length - 1] as any)?.content,
        hasParts: !!messages[messages.length - 1]?.parts,
        messageKeys: Object.keys(messages[messages.length - 1] || {}),
      });

      try {
        await saveMessageToSession(
          supabase,
          sessionId,
          messages[messages.length - 1]
        );
        console.log("[Chat API] Message save attempt completed");
      } catch (error) {
        console.error("[Chat API] Error during message save:", error);
        console.error(
          "[Chat API] Error stack:",
          error instanceof Error ? error.stack : "No stack trace"
        );
      }
    } else {
      console.log(
        "[Chat API] Not saving message - user:",
        !!user,
        "sessionId:",
        sessionId
      );
      if (!user) {
        console.log("[Chat API] No user found for message saving");
      }
      if (!sessionId) {
        console.log("[Chat API] No sessionId found for message saving");
      }
    }

    console.log(
      `[Chat API] About to call streamText with model:`,
      selectedModel
    );
    console.log(`[Chat API] Model info:`, modelInfo);

    const result = streamText({
      model: selectedModel as any,
      messages: convertToModelMessages(messages),
      tools: researchTools,
      toolChoice: "auto",
      experimental_context: {
        userId: user?.id,
        userTier,
        sessionId,
      },
      providerOptions: {
        openai: {
          store: true,
          reasoningEffort: "medium",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
      system: `You are a specialized AI assistant with access to comprehensive tools for clinical trials, drug information, biomedical literature, pharmaceutical analysis, Python code execution, and data visualization.
      
      CRITICAL CITATION INSTRUCTIONS:
      When you use ANY search tool and reference information from the results in your response:
      
      1. **Citation Format**: Use square brackets [1], [2], [3], etc.
      2. **Citation Placement**: Place citations at the END of each sentence or paragraph where you reference the information
      3. **Multiple Citations**: When multiple sources support the same statement, group them together: [1][2][3] or [1,2,3]
      4. **Sequential Numbering**: Number citations sequentially starting from [1] based on the order sources appear in your search results
      5. **Consistent References**: The same source always gets the same number throughout your response
      
      CITATION PLACEMENT RULES:
      - Place citations at the END of the sentence before the period: "Tesla's revenue grew 50% in Q3 2023 [1]."
      - For paragraphs with multiple facts from the same source, cite at the end of each fact or at paragraph end
      - Group multiple citations together when they support the same claim: "Multiple analysts confirm strong growth [1][2][3]."
      - For lists, place citations after each item if from different sources
      
      Example of PROPER citation usage:
      "Tesla reported revenue of $24.9 billion in Q3 2023, representing a 50% year-over-year increase [1]. The company's automotive gross margin reached 19.3%, exceeding analyst expectations [1][2]. Energy storage deployments surged 90% compared to the previous year [3]. These results demonstrate Tesla's strong operational performance across multiple business segments [1][2][3]."
      
      AVAILABLE TOOLS:
      
      **SEARCH TOOLS:**
      - **patentsSearch**: Search for patents and intellectual property (authoritative patent data, technical disclosures, innovation tracking)
      - **researchSearch**: Search research corpus for authoritative academic content (Wiley, PubMed, ArXiv)
      - **clinicalTrialsSearch**: Search for clinical trials based on conditions, drugs, or research criteria using ClinicalTrials.gov data
      - **getClinicalTrialDetails**: Get full detailed information about a specific clinical trial using its NCT ID
      
      **FILE PROCESSING TOOLS:**
      - **readTextFromUrl**: Fetch plain text files from URLs (text, JSON, XML formats)
      - **parsePdfFromUrl**: Download and extract text content from PDF files
      - **parseDocxFromUrl**: Download and extract text content from DOCX files using mammoth
      
      **ANALYSIS TOOLS:**
      - **codeExecution**: Execute Python code securely in a Daytona Sandbox for financial modeling, data analysis, and calculations
      - **createChart**: Create interactive charts for data visualization (line, bar, area charts with time series support)

      **CRITICAL NOTE**: You must only make max 5 parallel tool calls at a time.

      **CRITICAL INSTRUCTIONS**: Your reports must be incredibly thorough and detailed, explore everything that is relevant to the user's query that will help to provide
      the perfect response that is of a level expected of an elite level medical researcher or pharmaceutical analyst at a leading biomedical research institution.
      
      **TOOL USAGE GUIDELINES:**
      
      For patent searches, you can find information on:
      • Patent applications and granted patents
      • Technical disclosures and innovation tracking
      • Intellectual property landscape analysis
      • Patent citations and prior art
      • Technology trends and patent filings
      
      For research searches, you can access:
      • PubMed scientific papers and research articles
      • ArXiv preprints and academic publications
      • Wiley academic journals and books (ONLY for finance, business, and accounting research)
      • Peer-reviewed research with publication dates and source information
      
      For clinical trials searches, you can access:
      • ClinicalTrials.gov database with trial details
      • Phase information, enrollment data, and study status
      • Inclusion/exclusion criteria and study protocols
      • Principal investigators and study locations
      
      For file processing:
      • Extract text from PDF documents for analysis
      • Parse DOCX files for document content
      • Read plain text files from URLs
      
      For data analysis:
      • Execute Python code for calculations and modeling
      • Create interactive charts and visualizations
      • Perform statistical analysis and data processing
      
      Always use the appropriate tools when users ask for specific types of searches or analysis.
         
         ERROR RECOVERY: If any tool call fails due to validation errors, you will receive an error message explaining what went wrong. When this happens:
         1. Read the error message carefully to understand what fields are missing or incorrect
         2. Correct the tool call by providing ALL required fields with proper values
         5. Try the corrected tool call immediately - don't ask the user for clarification
         6. If multiple fields are missing, fix ALL of them in your retry attempt
         
                  When explaining mathematical concepts, formulas, or financial calculations, ALWAYS use LaTeX notation for clear mathematical expressions:
         
         CRITICAL: ALWAYS wrap ALL mathematical expressions in <math>...</math> tags:
         - For inline math: <math>FV = P(1 + r)^t</math>
         - For fractions: <math>\frac{r}{n} = \frac{0.07}{12}</math>
         - For exponents: <math>(1 + r)^{nt}</math>
         - For complex formulas: <math>FV = P \times \left(1 + \frac{r}{n}\right)^{nt}</math>
         
         NEVER write LaTeX code directly in text like \frac{r}{n} or \times - it must be inside <math> tags.
         NEVER use $ or $$ delimiters - only use <math>...</math> tags.
         This makes financial formulas much more readable and professional.
         Choose the patentsSearch tool for patent data, technical disclosures, and intellectual property information.
         Choose the researchSearch tool for academic papers, scientific literature, and peer-reviewed research.
         Choose the clinicalTrialsSearch tool for clinical trial data and medical research studies.
         Choose the chart creation tool when users want to visualize data, compare metrics, or see trends over time.

         When users ask for charts or data visualization, or when you have time series data:
         1. First gather the necessary data (using research search if needed)
         2. Then create an appropriate chart with that data (always visualize time series data)
         3. Ensure the chart has a clear title, proper axis labels, and meaningful data series names
         4. Colors are automatically assigned for optimal visual distinction

      Important: If you use the chart creation tool to plot a chart, do NOT add a link to the chart in your response. The chart will be rendered automatically for the user. Simply explain the chart and its insights, but do not include any hyperlinks or references to a chart link.

      When making multiple tool calls in parallel to retrieve time series data (for example, comparing several stocks or metrics), always specify the same time periods and date ranges for each tool call. This ensures the resulting data is directly comparable and can be visualized accurately on the same chart. If the user does not specify a date range, choose a reasonable default (such as the past year) and use it consistently across all tool calls for time series data.

      Provide clear explanations and context for all information. Offer practical advice when relevant.
      Be encouraging and supportive while helping users find accurate, up-to-date information.

      ---
      CRITICAL AGENT BEHAVIOR:
      - After every reasoning step, you must either call a tool or provide a final answer. Never stop after reasoning alone.
      - If you realize you need to correct a previous tool call, immediately issue the correct tool call.
      - If the user asks for multiple items (e.g., multiple companies), you must call the tool for each and only finish when all are processed and summarized.
      - Always continue until you have completed all required tool calls and provided a summary or visualization if appropriate.
      - NEVER suggest using Python to fetch data from the internet or APIs. All data retrieval must be done via the patentsSearch, researchSearch, or clinicalTrialsSearch tools.
      
      CRITICAL WORKFLOW ORDER:
      1. First: Complete ALL data gathering (searches, etc.)
      2. Finally: Present your final formatted response with analysis
      
      ---

      ---
      FINAL RESPONSE FORMATTING GUIDELINES:
      When presenting your final response to the user, you MUST format the information in an extremely well-organized and visually appealing way:

      1. **Use Rich Markdown Formatting:**
         - Use tables for comparative data, financial metrics, and any structured information
         - Use bullet points and numbered lists appropriately
         - Use **bold** for key metrics and important values
         - Use headers (##, ###) to organize sections clearly
         - Use blockquotes (>) for key insights or summaries

      2. **Tables for Financial Data:**
         - Present earnings, revenue, cash flow, and balance sheet data in markdown tables
         - Format numbers with proper comma separators (e.g., $1,234,567)
         - Include percentage changes and comparisons
         - Example:
         | Metric | Control | Treatment | P-Value |
         |--------|---------|-----------|----------|
         | Response Rate | 32.5% | 67.8% | <0.001 |
         | Adverse Events | 8.2% | 12.4% | 0.042 |

      3. **Mathematical Formulas:**
         - Always use <math> tags for any mathematical expressions
         - Present financial calculations clearly with proper notation

      4. **Data Organization:**
         - Group related information together
         - Use clear section headers
         - Provide executive summaries at the beginning
         - Include key takeaways at the end

      5. **Visual Hierarchy:**
         - Start with a brief executive summary
         - Present detailed findings in organized sections
         - Use horizontal rules (---) to separate major sections
         - End with key takeaways

      Remember: The goal is to present ALL retrieved data and facts in the most professional, readable, and visually appealing format possible. Think of it as creating a professional financial report or analyst presentation.
      
      8. **Citation Requirements:**
         - ALWAYS cite sources when using information from search results
         - Place citations [1], [2], etc. at the END of sentences or paragraphs
         - Group multiple citations together when they support the same point: [1][2][3]
         - Maintain consistent numbering throughout your response
         - Each unique search result gets ONE citation number used consistently
         - Citations are MANDATORY for:
           • Specific numbers, statistics, percentages
           • Clinical trial results and drug efficacy data  
           • Quotes or paraphrased statements
           • Market data and trends
           • Any factual claims from search results
         
         **CRITICAL for Clinical Trials:**
         - EVERY clinical trial mentioned MUST have an inline citation [N]
         - When citing clinical trials, use format: "The trial showed X result [1]" or "NCT04132960 demonstrated Y [2]"
         - Each NCT ID mentioned should have its corresponding citation immediately after
         - When using getClinicalTrialDetails, cite the detailed information retrieved
         - Example: "The Phase 3 RECOVERY trial (NCT04381936) enrolled over 40,000 patients [1] and demonstrated that dexamethasone reduced mortality by 17% [1]."
      ---
      `,
    });

    // Log streamText result object type
    console.log("[Chat API] streamText result type:", typeof result);
    console.log("[Chat API] streamText result:", result);

    // Create the streaming response with chat persistence
    const streamResponse = result.toUIMessageStreamResponse({
      sendReasoning: true,
      onFinish: async (completion) => {
        // Save assistant response
        console.log(
          "[Chat API] onFinish called - user:",
          !!user,
          "sessionId:",
          sessionId
        );
        if (user && sessionId) {
          console.log(
            "[Chat API] Saving assistant response to session:",
            sessionId
          );

          // Extract the content from the completion
          let messageContent = [];
          const responseMsg = completion.responseMessage;

          if (responseMsg && "content" in responseMsg) {
            if (typeof (responseMsg as any).content === "string") {
              messageContent = [
                { type: "text", text: (responseMsg as any).content },
              ];
            } else {
              messageContent = (responseMsg as any).content;
            }
          } else if (responseMsg && "parts" in responseMsg) {
            messageContent = (responseMsg as any).parts;
          }

          await saveMessageToSession(supabase, sessionId, {
            role: "assistant",
            content: messageContent,
            tool_calls: (responseMsg as any)?.toolCalls || null,
          });
        }

        // No manual usage tracking needed - Polar LLM Strategy handles this automatically!
        console.log(
          "[Chat API] AI usage automatically tracked by Polar LLM Strategy"
        );
      },
    });

    // Increment rate limit after successful validation but before processing
    if (isUserInitiated && !isDevelopment) {
      console.log(
        "[Chat API] Incrementing rate limit for user-initiated message"
      );
      try {
        if (user) {
          // Only increment server-side for authenticated users
          const rateLimitResult = await incrementRateLimit(user.id);
          console.log(
            "[Chat API] Authenticated user rate limit incremented:",
            rateLimitResult
          );
        } else {
          // Anonymous users handle increment client-side via useRateLimit hook
          console.log(
            "[Chat API] Skipping server-side increment for anonymous user (handled client-side)"
          );
        }
      } catch (error) {
        console.error("[Chat API] Failed to increment rate limit:", error);
        // Continue with processing even if increment fails
      }
    }

    if (isDevelopment) {
      // Add development mode headers
      streamResponse.headers.set("X-Development-Mode", "true");
      streamResponse.headers.set("X-RateLimit-Limit", "unlimited");
      streamResponse.headers.set("X-RateLimit-Remaining", "unlimited");
    }

    return streamResponse;
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function saveMessageToSession(
  supabase: any,
  sessionId: string,
  message: any
) {
  try {
    console.log(
      "[saveMessageToSession] Starting save process for sessionId:",
      sessionId
    );
    console.log(
      "[saveMessageToSession] Raw message:",
      JSON.stringify(message, null, 2)
    );

    // Validate required fields
    if (!sessionId) {
      console.error("[saveMessageToSession] No sessionId provided");
      return;
    }
    if (!message || !message.role) {
      console.error("[saveMessageToSession] Invalid message format:", message);
      return;
    }

    // Handle different message formats
    let content = [];

    if (message.parts) {
      console.log("[saveMessageToSession] Using message.parts");
      content = message.parts;
    } else if (message.content) {
      console.log("[saveMessageToSession] Using message.content");
      // If content is a string, wrap it in a text part
      if (typeof message.content === "string") {
        content = [{ type: "text", text: message.content }];
      } else {
        content = message.content;
      }
    } else if (message.text) {
      console.log("[saveMessageToSession] Using message.text");
      content = [{ type: "text", text: message.text }];
    } else {
      console.log("[saveMessageToSession] No recognized content field found");
      content = [{ type: "text", text: "No content found" }];
    }

    // Ensure content is properly formatted for database storage
    const contentData = content;

    const existingTokenUsage =
      message.token_usage ?? message.tokenUsage ?? null;

    let tokenUsagePayload: any =
      existingTokenUsage && typeof existingTokenUsage === "object"
        ? { ...existingTokenUsage }
        : existingTokenUsage ?? null;

    if (message.contextResources) {
      if (
        tokenUsagePayload &&
        typeof tokenUsagePayload === "object" &&
        !Array.isArray(tokenUsagePayload)
      ) {
        tokenUsagePayload = {
          ...tokenUsagePayload,
          contextResources: message.contextResources,
        };
      } else {
        tokenUsagePayload = {
          contextResources: message.contextResources,
        };
      }
    }

    const insertData = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      role: message.role,
      content: contentData,
      tool_calls: message.tool_calls || message.toolCalls || null,
      token_usage:
        tokenUsagePayload === undefined ? null : tokenUsagePayload,
    };

    console.log(
      "[saveMessageToSession] Content data structure:",
      JSON.stringify(contentData, null, 2)
    );

    console.log(
      "[saveMessageToSession] Inserting data:",
      JSON.stringify(insertData, null, 2)
    );

    // Check if session exists first
    console.log("[saveMessageToSession] Checking if session exists...");
    const { data: sessionData, error: sessionError } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .single();

    if (sessionError) {
      console.error(
        "[saveMessageToSession] Session does not exist:",
        sessionError
      );
      console.log(
        "[saveMessageToSession] Waiting 100ms and retrying session check..."
      );

      // Wait a bit for session to be fully created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Retry session check
      const { data: retrySessionData, error: retrySessionError } =
        await supabase
          .from("chat_sessions")
          .select("id")
          .eq("id", sessionId)
          .single();

      if (retrySessionError) {
        console.error(
          "[saveMessageToSession] Session still does not exist after retry:",
          retrySessionError
        );
        console.log(
          "[saveMessageToSession] Cannot save message - session must be created first"
        );
        return;
      } else {
        console.log(
          "[saveMessageToSession] Session exists after retry:",
          retrySessionData
        );
      }
    } else {
      console.log("[saveMessageToSession] Session exists:", sessionData);
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .insert(insertData)
      .select();

    if (error) {
      console.error("[saveMessageToSession] Database error:", error);
      console.error(
        "[saveMessageToSession] Error details:",
        JSON.stringify(error, null, 2)
      );
      console.error("[saveMessageToSession] Error code:", error.code);
      console.error("[saveMessageToSession] Error message:", error.message);
      console.error("[saveMessageToSession] Error hint:", error.hint);
    } else {
      console.log("[saveMessageToSession] Successfully saved message:", data);
      console.log("[saveMessageToSession] Saved message ID:", data?.[0]?.id);
    }
  } catch (error) {
    console.error("[saveMessageToSession] Exception:", error);
    console.error(
      "[saveMessageToSession] Exception stack:",
      error instanceof Error ? error.stack : "No stack trace"
    );
  }
}
