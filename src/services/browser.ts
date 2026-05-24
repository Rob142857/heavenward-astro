export function isSocialInAppBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|FB_IAB|FB4A|FBIOS|Instagram|Line\/|MicroMessenger/i.test(
    ua,
  );
}
