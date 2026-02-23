import { env } from "@//lib/constants";
import emojiStrip from "emoji-strip";
import type { recipeInfo, recipeResult } from "./types";

export async function postRecipe(recipeData: any) {
    try {
        const payloadData =
            typeof recipeData === "string"
                ? recipeData
                : JSON.stringify(recipeData);

        const res = await fetch(
            `${env.MEALIE_URL}/api/recipes/create/html-or-json`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${env.MEALIE_API_KEY}`,
                },
                body: JSON.stringify({
                    includeTags: true,
                    data: payloadData,
                }),
                signal: AbortSignal.timeout(120000),
            }
        );

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`${res.status} ${res.statusText} - ${errorText}`);
            throw new Error("Failed to create recipe");
        }
        const body = await res.json();
        console.log("Recipe response:", body);
        return body;
    } catch (error: any) {
        if (error.name === "AbortError") {
            console.error(
                "Timeout creating mealie recipe. Report this issue on Mealie GitHub."
            );
            throw new Error(
                `Timeout creating mealie recipe. Report this issue on Mealie GitHub. Input URL: ${env.MEALIE_URL}`
            );
        }
        console.error("Error in postRecipe:", error);
        throw new Error(error.message);
    }
}

export async function uploadRecipeImage(recipeSlug: string, imageUrl: string): Promise<void> {
    try {
        // Download the image with a browser-like User-Agent to avoid 403s
        const imageRes = await fetch(imageUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": "https://www.instagram.com/",
            },
            signal: AbortSignal.timeout(30000),
        });

        if (!imageRes.ok) {
            console.warn(`Failed to download thumbnail (${imageRes.status}), skipping image upload`);
            return;
        }

        const imageBuffer = await imageRes.arrayBuffer();
        const contentType = imageRes.headers.get("content-type") || "image/jpeg";
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

        const formData = new FormData();
        formData.append(
            "image",
            new Blob([imageBuffer], { type: contentType }),
            `image.${ext}`
        );
        formData.append("extension", ext);

        const res = await fetch(
            `${env.MEALIE_URL}/api/recipes/${recipeSlug}/image`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${env.MEALIE_API_KEY}`,
                },
                body: formData,
                signal: AbortSignal.timeout(30000),
            }
        );

        if (!res.ok) {
            const errorText = await res.text();
            console.warn(`Failed to upload image to Mealie (${res.status}): ${errorText}`);
        } else {
            console.log("Image uploaded to Mealie successfully");
        }
    } catch (error: any) {
        // Non-fatal — log and continue
        console.warn("Error uploading recipe image:", error.message);
    }
}

export async function getRecipe(recipeSlug: string): Promise<recipeResult> {
    const res = await fetch(`${env.MEALIE_URL}/api/recipes/${recipeSlug}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.MEALIE_API_KEY}`,
        },
    });

    const body = await res.json();
    if (!res.ok) throw new Error("Failed to get recipe");

    return {
        name: body.name,
        description: body.description,
        imageUrl: `${env.MEALIE_URL}/api/media/recipes/${body.id}/images/original.webp`,
        url: `${env.MEALIE_URL}/g/${env.MEALIE_GROUP_NAME}/r/${recipeSlug}`,
    };
}