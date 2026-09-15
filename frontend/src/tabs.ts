/**
 * Tab Navigation and Responsive Chart Resizing
 */

export function switchTab(tabId: string): void {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((content) => content.classList.remove("active"));

  const targetBtn = Array.from(document.querySelectorAll(".tab-btn")).find((btn) => {
    const attr = btn.getAttribute("onclick");
    return attr && attr.includes(tabId);
  });
  if (targetBtn) targetBtn.classList.add("active");

  const targetContent = document.getElementById(tabId);
  if (targetContent) targetContent.classList.add("active");

  window.dispatchEvent(new Event("resize"));
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
    if (targetContent) {
      targetContent.querySelectorAll(".js-plotly-plot").forEach((el) => {
        Plotly.Plots.resize(el);
      });
    }
  }, 40);
}
