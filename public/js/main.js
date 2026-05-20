document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('main-nav');

  if (hamburger && nav) {
    hamburger.addEventListener('click', () => {
      nav.classList.toggle('active');
    });
  }

  const swiperEl = document.querySelector('.swiper');
  if (swiperEl && typeof Swiper !== 'undefined') {
    new Swiper(swiperEl, {
      loop: true,
      autoplay: {
        delay: 4000,
        disableOnInteraction: false,
      },
      effect: 'fade',
      fadeEffect: {
        crossFade: true,
      },
    });
  }

  const swiperLateralEl = document.querySelector('.swiperlateral');
  if (swiperLateralEl && typeof Swiper !== 'undefined') {
    new Swiper(swiperLateralEl, {
      loop: true,
      autoplay: { delay: 5000 },
      pagination: { el: '.swiper-pagination', clickable: true },
    });
  }
});
