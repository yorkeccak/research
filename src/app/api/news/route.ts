import { NextRequest, NextResponse } from "next/server";
import { Valyu } from "valyu-js";

// In-memory cache for serverless environment
let memoryCache: {
  newsItems: any[];
  timestamp: number;
} | null = null;

// Separate function to fetch news data
async function fetchNewsData() {

  const valyuApiKey = process.env.VALYU_API_KEY;

  if (!valyuApiKey) {
    throw new Error("Valyu API key not configured");
  }

  const valyu = new Valyu(valyuApiKey, "https://api.valyu.network/v1");

  // Search for international news from different countries and sources
  const newsQueries = [
    "latest biomedical research news today",
    "latest AI research news today",
    "latest climate science research news today",
    "latest neuroscience research news today",
    "latest cancer research news today",
    "latest renewable energy research news today",
    "latest genetics research news today",
    "latest materials science research news today",
    "latest pharmaceutical research news today",
    "latest public health research news today",
  ];

  console.log("Running news queries...");

  // Try multiple queries to get diverse news content
  let allResults: any[] = [];
  for (const query of newsQueries) {
    try {
      console.log(`Searching for: ${query}`);
      const response = await valyu.search(query);
      console.log(
        `Response for "${query}":`,
        response?.results?.length || 0,
        "results"
      );
      if (response?.results && response.results.length > 0) {
        allResults = [...allResults, ...response.results];
        console.log(
          `Added ${response.results.length} results, total: ${allResults.length}`
        );
      }
    } catch (queryError) {
      console.error(`Error with query "${query}":`, queryError);
      // Continue with other queries
    }
  }

  console.log(`Total results collected: ${allResults.length}`);

  if (allResults.length === 0) {
    return [];
  }

  // Map results and remove duplicates
  const newsItems = allResults
    .map((item: any) => ({
      title: item.title || "News Article",
      url: item.url,
      image_url: item.image_url || null,
      content: item.content || "",
      source: item.metadata?.source || "News Source",
      date: item.metadata?.date || new Date().toISOString(),
    }))
    // Remove duplicates based on URL
    .filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.url === item.url)
    )
    // Remove duplicates based on title
    .filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.title === item.title)
    )
    // Ban Politico and USA Today sources
    .filter(
      (item) =>
        !item.url.toLowerCase().includes("politico") &&
        !item.source.toLowerCase().includes("politico") &&
        !item.title.toLowerCase().includes("politico") &&
        !item.url.toLowerCase().includes("usatoday") &&
        !item.source.toLowerCase().includes("usatoday") &&
        !item.title.toLowerCase().includes("usatoday")
    )
    // Limit to 30 articles for performance
    .slice(0, 30);

  console.log(`Final news items: ${newsItems.length}`);

  return newsItems;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get("refresh") === "true";

    // Check in-memory cache first
    if (memoryCache && !refresh) {
      const cacheAge = Date.now() - memoryCache.timestamp;
      const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

      if (cacheAge < oneHour) {
        console.log("Returning cached news (in-memory)");
        return NextResponse.json({
          newsItems: memoryCache.newsItems,
          total: memoryCache.newsItems.length,
          cached: true,
        });
      }
    }

    console.log("Fetching fresh news data...");

    try {
      const newsItems = await fetchNewsData();

      // Update in-memory cache
      memoryCache = {
        newsItems,
        timestamp: Date.now(),
      };

      return NextResponse.json({
        newsItems,
        total: newsItems.length,
        cached: false,
      });
    } catch (error) {
      console.error("Error fetching news:", error);

      // If we have stale cache, return it with an indicator
      if (memoryCache) {
        console.log("Returning stale cache due to fetch error");
        return NextResponse.json({
          newsItems: memoryCache.newsItems,
          total: memoryCache.newsItems.length,
          cached: true,
          stale: true,
        });
      }

      return NextResponse.json(
        { error: "Failed to fetch news" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error in news API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
