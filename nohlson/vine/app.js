const BASE = "vine archive/";

let DATA = null;
let currentIndex = -1;

fetch("data.json")
  .then(r => r.json())
  .then(data => {
    DATA = data;
    render();
  });

function render() {
  const u = DATA.user;
  document.getElementById("avatar").src = BASE + u.avatar;
  document.getElementById("username").textContent = u.username;
  document.getElementById("userdesc").textContent = u.description || "";
  document.getElementById("postCount").textContent = u.postCount;
  document.getElementById("followerCount").textContent = u.followerCount;
  document.getElementById("followingCount").textContent = u.followingCount;
  document.getElementById("loopCount").textContent = u.loopCount;

  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  DATA.posts.forEach((post, i) => {
    const el = document.createElement("div");
    el.className = "thumb";
    el.innerHTML = `
      <img src="${BASE + post.thumb}" loading="lazy" alt="">
      <div class="overlay-stats">
        <span>&hearts; ${post.likes}</span>
        <span>&#8635; ${post.loops}</span>
      </div>
    `;
    el.addEventListener("click", () => openLightbox(i));
    grid.appendChild(el);
  });
}

function openLightbox(index) {
  currentIndex = index;
  const post = DATA.posts[index];
  const video = document.getElementById("lightboxVideo");
  video.src = BASE + post.video;
  video.play().catch(() => {});

  document.getElementById("lbDescription").textContent = post.description || "";
  document.getElementById("lbLikes").textContent = `♥ ${post.likes}`;
  document.getElementById("lbComments").textContent = `\u{1F4AC} ${post.comments}`;
  document.getElementById("lbReposts").textContent = `\u{1F501} ${post.reposts}`;
  document.getElementById("lbLoops").textContent = `⟳ ${post.loops} loops`;
  document.getElementById("lbDate").textContent = formatDate(post.created);

  document.getElementById("lightbox").classList.remove("hidden");
}

function closeLightbox() {
  const video = document.getElementById("lightboxVideo");
  video.pause();
  video.src = "";
  document.getElementById("lightbox").classList.add("hidden");
}

function showRelative(delta) {
  const next = currentIndex + delta;
  if (next < 0 || next >= DATA.posts.length) return;
  openLightbox(next);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

document.getElementById("closeBtn").addEventListener("click", closeLightbox);
document.getElementById("prevBtn").addEventListener("click", () => showRelative(-1));
document.getElementById("nextBtn").addEventListener("click", () => showRelative(1));
document.getElementById("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (document.getElementById("lightbox").classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") showRelative(-1);
  if (e.key === "ArrowRight") showRelative(1);
});
