import { getRecipe, postRecipe, uploadRecipeImage } from "@/lib/mealie";
import type { progressType, socialMediaResult } from "@/lib/types";
import { generateRecipeFromAI, getTranscription } from "@/lib/ai";
import { env } from "@/lib/constants";
import { downloadMediaWithYtDlp } from "@/lib/yt-dlp";

interface RequestBody {
    url: string;
    tags: string[];
}
async function handleRequest(
    url: string,
    tags: string[],
    isSse: boolean,
    controller?: ReadableStreamDefaultController
) {
    const encoder = new TextEncoder();
    let socialMediaResult: socialMediaResult;
    let transcription = "There is not transcriptions";

    const progress: progressType = {
        videoDownloaded: null,
        audioTranscribed: null,
        recipeCreated: null,
    };

    try {
        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
        }
        socialMediaResult = await downloadMediaWithYtDlp(url);
        progress.videoDownloaded = true;

        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
        }
        if (socialMediaResult.blob) {
            transcription = await getTranscription(socialMediaResult.blob);
            progress.audioTranscribed = true;
            if (isSse && controller) {
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({progress})}\n\n`)
                );
            }
        }

        // Generate recipe JSON using AI
        const recipe = await generateRecipeFromAI(
            transcription,
            socialMediaResult.description,
            url,
            socialMediaResult.thumbnail,
            env.EXTRA_PROMPT || "",
            tags,
            socialMediaResult.images
        );

        // Strip the image URL from the recipe before posting — we will upload it directly
        const thumbnailUrl = recipe?.image || socialMediaResult.thumbnail;
        if (recipe) {
            delete recipe.image;
        }

        console.log("Posting recipe to Mealie", recipe);
        const mealieResponse = await postRecipe(recipe);
        const recipeSlug = await mealieResponse;

        // Upload thumbnail directly to Mealie to avoid Instagram CDN 403s
        if (thumbnailUrl && thumbnailUrl !== "notfound") {
            console.log("Uploading thumbnail to Mealie:", thumbnailUrl);
            await uploadRecipeImage(recipeSlug, thumbnailUrl);
        }

        const createdRecipe = await getRecipe(recipeSlug);
        console.log("Recipe created");
        progress.recipeCreated = true;
        if (isSse && controller) {
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`)
            );
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(createdRecipe)}\n\n`)
            );
            controller.close();
            return;
        }
        return new Response(JSON.stringify({ createdRecipe, progress }), {
            status: 200,
        });
    } catch (error: any) {
        if (isSse && controller) {
            progress.recipeCreated = false;
            controller.enqueue(
                encoder.encode(
                    `data: ${JSON.stringify({
                        error: error.message,
                        progress,
                    })}\n\n`
                )
            );
            controller.close();
            return;
        }
        return new Response(
            JSON.stringify({ error: error.message, progress }),
            { status: 500 }
        );
    }
}

export async function POST(req: Request) {
    const body: RequestBody = await req.json();
    const url = body.url;
    const tags = body.tags;
    const contentType = req.headers.get("Content-Type");

    if (contentType === "text/event-stream") {
        const stream = new ReadableStream({
            async start(controller) {
                await handleRequest(url, tags, true, controller);
            },
        });
        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    }
    return handleRequest(url, tags, false);
}

export async function GET(req: Request) {
    const url = new URL(req.url).searchParams.get("url");
    const tags = new URL(req.url).searchParams.getAll("tags");
    if (!url) {
        return new Response(JSON.stringify({ error: "URL is required" }), {
            status: 400,
        });
    }
    return handleRequest(url, tags, false);
}