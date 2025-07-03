// src/index.ts

import ky from 'ky';
import { HTTPError } from 'ky';

// ==================================================================================
// 核心常量 - 这些值非常脆弱，Twitter/X 更新后可能会失效
// ==================================================================================

// 从 Nitter 项目同步的 Twitter/X 内部 GraphQL API 端点和查询 ID。
const GRAPHQL_ENDPOINTS = {
    UserByScreenName: "https://api.x.com/graphql/u7wQyGi6oExe8_TRWGMq4Q/UserResultByScreenNameQuery",
    UserTweets: "https://api.x.com/graphql/JLApJKFY0MxGTzCoK6ps8Q/UserWithProfileTweetsQueryV2",
};

// 从 Nitter 项目同步的 GraphQL features 参数
const GQL_FEATURES = {
    "android_graphql_skip_api_media_color_palette": false,
    "blue_business_profile_image_shape_enabled": false,
    "creator_subscriptions_subscription_count_enabled": false,
    "creator_subscriptions_tweet_preview_api_enabled": true,
    "freedom_of_speech_not_reach_fetch_enabled": false,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": false,
    "hidden_profile_likes_enabled": false,
    "highlights_tweets_tab_ui_enabled": false,
    "interactive_text_enabled": false,
    "longform_notetweets_consumption_enabled": true,
    "longform_notetweets_inline_media_enabled": false,
    "longform_notetweets_richtext_consumption_enabled": true,
    "longform_notetweets_rich_text_read_enabled": false,
    "responsive_web_edit_tweet_api_enabled": false,
    "responsive_web_enhance_cards_enabled": false,
    "responsive_web_graphql_exclude_directive_enabled": true,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
    "responsive_web_graphql_timeline_navigation_enabled": false,
    "responsive_web_media_download_video_enabled": false,
    "responsive_web_text_conversations_enabled": false,
    "responsive_web_twitter_article_tweet_consumption_enabled": false,
    "responsive_web_twitter_blue_verified_badge_is_enabled": true,
    "rweb_lists_timeline_redesign_enabled": true,
    "spaces_2022_h2_clipping": true,
    "spaces_2022_h2_spaces_communities": true,
    "standardized_nudges_misinfo": false,
    "subscriptions_verification_info_enabled": true,
    "subscriptions_verification_info_reason_enabled": true,
    "subscriptions_verification_info_verified_since_enabled": true,
    "super_follow_badge_privacy_enabled": false,
    "super_follow_exclusive_tweet_notifications_enabled": false,
    "super_follow_tweet_api_enabled": false,
    "super_follow_user_api_enabled": false,
    "tweet_awards_web_tipping_enabled": false,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": false,
    "tweetypie_unmention_optimization_enabled": false,
    "unified_cards_ad_metadata_container_dynamic_card_content_query_enabled": false,
    "verified_phone_label_enabled": false,
    "vibe_api_enabled": false,
    "view_counts_everywhere_api_enabled": false,
    "premium_content_api_read_enabled": false,
    "communities_web_enable_tweet_community_results_fetch": false,
    "responsive_web_jetfuel_frame": false,
    "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
    "responsive_web_grok_image_annotation_enabled": false,
    "rweb_tipjar_consumption_enabled": false,
    "profile_label_improvements_pcf_label_in_post_enabled": false,
    "creator_subscriptions_quote_tweet_preview_enabled": false,
    "c9s_tweet_anatomy_moderator_badge_enabled": false,
    "responsive_web_grok_analyze_post_followups_enabled": false,
    "rweb_video_timestamps_enabled": false,
    "responsive_web_grok_share_attachment_enabled": false,
    "articles_preview_enabled": false,
    "immersive_video_status_linkable_timestamps": false,
    "articles_api_enabled": false,
    "responsive_web_grok_analysis_button_from_backend": false
};

let bearerToken: string;

// ==================================================================================
// 步骤 1: 获取 Bearer Token 和访客 Token (Guest Token)
// ==================================================================================

/**
 * 模拟客户端激活，获取用于后续请求的 Guest Token。
 * @returns {Promise<string>} Guest Token.
 */
async function getGuestToken(): Promise<string> {
    console.log("1. 获取 Guest Token...");
    try {
        if (!bearerToken) {
            const mainJsUrl = await ky.get("https://x.com/home", {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
                }
            }).text();
            const mainJsUrlMatch = mainJsUrl.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web-legacy\/main\.[a-z0-9]+\.js/);
            if (!mainJsUrlMatch) {
                throw new Error("无法从主页中提取 main.js 的 URL");
            }
            const mainJsContent = await ky.get(mainJsUrlMatch[0]).text();
            const bearerTokenMatch = mainJsContent.match(/"(AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA)"/);
            if (!bearerTokenMatch) {
                throw new Error("无法从 main.js 中提取 Bearer Token");
            }
            bearerToken = bearerTokenMatch[1];
        }

        const data: { guest_token: string } = await ky.post('https://api.twitter.com/1.1/guest/activate.json', {
            headers: {
                'Authorization': `Bearer ${bearerToken}`
            }
        }).json();
        const token = data.guest_token;
        if (!token) {
            throw new Error("未能从响应中获取 guest_token");
        }
        console.log(`   > 成功获取 Guest Token: ${token.substring(0, 20)}...`);
        return token;
    } catch (error) {
        if (error instanceof HTTPError) {
            const errorText = await error.response.text();
            console.error("获取 Guest Token 失败：", errorText || error.message);
        } else {
            console.error("获取 Guest Token 失败：", error);
        }
        throw error;
    }
}

// ==================================================================================
// 步骤 2: 通过用户名获取用户的 rest_id
// ==================================================================================

/**
 * 使用用户名 (screen_name) 查询用户的数字 ID (rest_id)。
 * @param screenName 用户的 @ Handle, 例如 "zhanghedev"
 * @param guestToken 从 getGuestToken() 获取的 Token
 * @returns {Promise<string>} 用户的 rest_id
 */
async function getUserIdByScreenName(screenName: string, guestToken: string): Promise<string> {
    console.log(`2. 查询用户 "${screenName}" 的 rest_id...`);
    const variables = {
        screen_name: screenName,
        withSafetyModeUserFields: true,
    };

    try {
        const data: any = await ky.get(GRAPHQL_ENDPOINTS.UserByScreenName, {
            searchParams: {
                variables: JSON.stringify(variables),
                features: JSON.stringify(GQL_FEATURES),
            },
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'x-guest-token': guestToken,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
                'x-twitter-active-user': 'yes',
                'authority': 'api.x.com',
                'accept-encoding': 'gzip',
                'accept-language': 'en-US,en;q=0.9',
                'accept': '*/*',
                'DNT': '1'
            }
        }).json();

        const userId = data?.data?.user?.result?.rest_id;
        if (!userId) {
            throw new Error("未能从响应中解析出 rest_id");
        }
        console.log(`   > 成功获取 rest_id: ${userId}`);
        return userId;
    } catch (error) {
        if (error instanceof HTTPError) {
            const errorText = await error.response.text();
            console.error("查询用户 ID 失败：", errorText || error.message);
        } else {
            console.error("查询用户 ID 失败：", error);
        }
        throw error;
    }
}

// ==================================================================================
// 步骤 3: 获取用户时间线
// ==================================================================================

/**
 * 获取指定用户 ID 的时间线推文。
 * @param userId 用户的 rest_id
 * @param guestToken Guest Token
 * @returns {Promise<any>} 包含推文数据的 API 响应
 */
async function getUserTimeline(userId: string, guestToken: string): Promise<any> {
    console.log(`3. 获取用户 ID ${userId} 的时间线...`);
    const variables = {
        rest_id: userId,
        count: 20
    };

    try {
        const data = await ky.get(GRAPHQL_ENDPOINTS.UserTweets, {
            searchParams: {
                variables: JSON.stringify(variables),
                features: JSON.stringify(GQL_FEATURES),
            },
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'x-guest-token': guestToken,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
                'x-twitter-active-user': 'yes',
                'authority': 'api.x.com',
                'accept-encoding': 'gzip',
                'accept-language': 'en-US,en;q=0.9',
                'accept': '*/*',
                'DNT': '1'
            }
        }).json();
        console.log("   > 成功获取时间线数据。");
        return data;
    } catch (error) {
        if (error instanceof HTTPError) {
            const errorText = await error.response.text();
            console.error("获取用户时间线失败：", errorText || error.message);
        } else {
            console.error("获取用户时间线失败：", error);
        }
        throw error;
    }
}

// ==================================================================================
// 步骤 4: 解析并展示结果
// ==================================================================================

function parseAndDisplayTimeline(timelineData: any) {
    console.log("\n4. 解析并展示推文结果:\n" + "=".repeat(40));
    try {
        // 数据嵌套在很深的结构里
        const instructions = timelineData.data.user.result.timeline_v2.timeline.instructions;
        const tweetEntries = instructions.find((inst: any) => inst.type === 'TimelineAddEntries').entries;

        let tweetCount = 0;
        for (const entry of tweetEntries) {
            if (entry.entryId.startsWith('tweet-')) {
                const tweetResult = entry.content.itemContent?.tweet_results?.result;
                // 有时推文会有一个 __typename 来区分，例如 TweetWithVisibilityResults
                const legacyTweet = tweetResult?.legacy ?? tweetResult?.tweet?.legacy;

                if (legacyTweet) {
                    tweetCount++;
                    console.log(`\n[ 推文 ${tweetCount} ]`);
                    console.log(`  发布于：${legacyTweet.created_at}`);
                    console.log(`  内容：${legacyTweet.full_text.replace(/\n/g, '\n        ')}`);
                    console.log(`  转推：${legacyTweet.retweet_count} | 喜欢：${legacyTweet.favorite_count}`);
                }
            }
        }
        if (tweetCount === 0) {
            console.log("在返回的数据中没有找到有效的推文。");
        }
    } catch (error) {
        console.error("解析时间线数据失败：", error instanceof Error ? error.message : String(error));
        console.log("原始数据结构可能已改变，请检查 `timelineData` 对象。");
    }
}


// ==================================================================================
// 主函数
// ==================================================================================

async function main() {
    const screenName = "zhanghedev"; // 你想查询的用户名

    try {
        const guestToken = await getGuestToken();
        const userId = await getUserIdByScreenName(screenName, guestToken);
        const timelineData = await getUserTimeline(userId, guestToken);
        parseAndDisplayTimeline(timelineData);
    } catch (error) {
        console.error(`\n[!] 操作失败。由于 Twitter/X 经常更新其内部 API，此脚本可能已失效。`);
    }
}

main();
