import { googleClientId, googleClientSecret } from "@/lib/env/config";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Authentication required",
        },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { videoUrl, script } = body;

    if (!videoUrl || !script) {
      return NextResponse.json(
        {
          success: false,
          message: "Video URL and script are required",
        },
        { status: 400 }
      );
    }

    // Get user from database to check for refresh token
    const dbUser = await prisma.user.findUnique({
      where: {
        clerkId: user.id,
      },
    });

    if (!dbUser?.youtubeRefreshToken) {
      return NextResponse.json(
        {
          success: false,
          message:
            "YouTube account not connected. Please connect your YouTube account first.",
        },
        { status: 400 }
      );
    }

    // Get fresh access token directly
    const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: googleClientId || "",
        client_secret: googleClientSecret || "",
        refresh_token: dbUser.youtubeRefreshToken,
        grant_type: "refresh_token",
      }),
    });

    const refreshData = await refreshResponse.json();

    if (!refreshResponse.ok) {
      console.error("Token refresh failed:", refreshData);

      // If refresh token is invalid, remove it from database
      if (refreshResponse.status === 400 || refreshResponse.status === 401) {
        await prisma.user.update({
          where: {
            clerkId: user.id,
          },
          data: {
            youtubeRefreshToken: null,
          },
        });
      }

      return NextResponse.json(
        {
          success: false,
          message:
            "Failed to get YouTube access token. Please reconnect your account.",
        },
        { status: 400 }
      );
    }

    const result = await inngest.send({
      name: "upload-video-on-youtube",
      data: {
        videoUrl,
        script,
        userId: user.id,
        accessToken: refreshData.access_token,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message:
          "Video Uploading. We will notify you using email when it is uploaded",
        data: result,
      },
      { status: 202 }
    );
  } catch (error: any) {
    console.error("Error initiating YouTube upload:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Failed to initiate YouTube upload.",
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
