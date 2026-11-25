export function parseUserAgent(ua: string): { device: "mobile" | "tablet" | "desktop"; inWechat: boolean } {
  const inWechat = /MicroMessenger/i.test(ua);
  const tablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const mobile = /Mobi|iPhone|iPod|Android|HarmonyOS/i.test(ua);
  return { device: tablet ? "tablet" : mobile ? "mobile" : "desktop", inWechat };
}
