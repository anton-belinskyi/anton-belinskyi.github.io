const desktopQuery = window.matchMedia('(min-width: 48rem)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeOutCubic = (progress) => 1 - (1 - progress) ** 3;
const VISIBLE_ON_MOBILE = 4;
const REVEAL_DURATION = 350;
const DECODE_TIMEOUT = 400;

class ProductSlider extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-slider-track]');
    this.bar = this.querySelector('[data-slider-bar]');
    this.thumb = this.querySelector('[data-slider-thumb]');
    this.update = this.update.bind(this);

    this.track.addEventListener('scroll', this.update, { passive: true });
    this.track.addEventListener('dragstart', (event) => event.preventDefault());
    this.track.addEventListener('pointerdown', (event) => this.startTrackDrag(event));
    this.bar.addEventListener('pointerdown', (event) => this.startBarDrag(event));
    this.track.addEventListener('wheel', () => this.stopSettle(), { passive: true });

    this.resizeObserver = new ResizeObserver(this.update);
    this.resizeObserver.observe(this.track);
    this.resizeObserver.observe(this.bar);
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
    this.stopSettle();
  }

  get maxScroll() {
    return this.track.scrollWidth - this.track.clientWidth;
  }

  update() {
    const { scrollLeft, scrollWidth, clientWidth } = this.track;
    const barWidth = this.bar.clientWidth;
    const thumbWidth = scrollWidth > 0 ? Math.max((barWidth * clientWidth) / scrollWidth, 48) : 0;
    const progress = this.maxScroll > 0 ? scrollLeft / this.maxScroll : 0;

    this.bar.hidden = this.maxScroll <= 0;
    this.thumb.style.width = `${thumbWidth}px`;
    this.thumb.style.transform = `translateX(${(barWidth - thumbWidth) * progress}px)`;
  }

  nearestSnapOffset() {
    const { scrollLeft } = this.track;
    const trackLeft = this.track.getBoundingClientRect().left;
    const scrollPadding = parseFloat(getComputedStyle(this.track).scrollPaddingLeft) || 0;
    const offsets = [...this.track.children].map((item) => clamp(item.getBoundingClientRect().left - trackLeft + scrollLeft - scrollPadding, 0, this.maxScroll));

    return [...offsets, this.maxScroll].reduce((nearest, offset) => (Math.abs(offset - scrollLeft) < Math.abs(nearest - scrollLeft) ? offset : nearest));
  }

  settle() {
    this.stopSettle();

    const from = this.track.scrollLeft;
    const distance = this.nearestSnapOffset() - from;
    const duration = reducedMotionQuery.matches ? 0 : clamp(Math.abs(distance) * 2, 250, 500);

    if (Math.abs(distance) < 1 || duration === 0) {
      this.track.scrollLeft = from + distance;
      this.track.removeAttribute('data-dragging');
      return;
    }

    const start = performance.now();

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      this.track.scrollLeft = from + distance * easeOutCubic(progress);

      if (progress < 1) {
        this.settleFrame = requestAnimationFrame(step);
        return;
      }

      this.settleFrame = null;
      this.track.removeAttribute('data-dragging');
    };

    this.settleFrame = requestAnimationFrame(step);
  }

  stopSettle() {
    if (!this.settleFrame) return;

    cancelAnimationFrame(this.settleFrame);
    this.settleFrame = null;
    this.track.removeAttribute('data-dragging');
  }

  startTrackDrag(event) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !desktopQuery.matches) return;

    this.stopSettle();

    const startX = event.clientX;
    const startScroll = this.track.scrollLeft;
    let dragging = false;

    const controller = new AbortController();
    const { signal } = controller;

    const move = (moveEvent) => {
      const delta = moveEvent.clientX - startX;

      if (!dragging && Math.abs(delta) > 4) {
        dragging = true;
        this.track.setPointerCapture(moveEvent.pointerId);
        this.track.toggleAttribute('data-dragging', true);
      }

      if (dragging) this.track.scrollLeft = startScroll - delta;
    };

    const end = () => {
      controller.abort();
      if (!dragging) return;

      this.settle();
      this.track.addEventListener('click', (clickEvent) => clickEvent.preventDefault(), { capture: true, once: true });
    };

    window.addEventListener('pointermove', move, { signal });
    window.addEventListener('pointerup', end, { signal });
    window.addEventListener('pointercancel', end, { signal });
  }

  startBarDrag(event) {
    if (event.button !== 0 || this.maxScroll <= 0) return;

    event.preventDefault();
    this.stopSettle();
    this.bar.setPointerCapture(event.pointerId);
    this.bar.toggleAttribute('data-active', true);
    this.track.toggleAttribute('data-dragging', true);

    const barRect = this.bar.getBoundingClientRect();
    const thumbRect = this.thumb.getBoundingClientRect();
    const onThumb = event.clientX >= thumbRect.left && event.clientX <= thumbRect.right;
    const grabOffset = onThumb ? event.clientX - thumbRect.left : thumbRect.width / 2;

    const scrollTo = (clientX) => {
      const ratio = (clientX - barRect.left - grabOffset) / (barRect.width - thumbRect.width);
      this.track.scrollLeft = clamp(ratio, 0, 1) * this.maxScroll;
    };

    const controller = new AbortController();
    const { signal } = controller;

    const end = () => {
      controller.abort();
      this.bar.removeAttribute('data-active');
      this.settle();
    };

    if (!onThumb) scrollTo(event.clientX);
    this.bar.addEventListener('pointermove', (moveEvent) => scrollTo(moveEvent.clientX), { signal });
    this.bar.addEventListener('pointerup', end, { signal });
    this.bar.addEventListener('pointercancel', end, { signal });
  }
}

class ProductReveal extends HTMLElement {
  connectedCallback() {
    this.list = this.querySelector('[data-slider-track]');
    this.button = this.querySelector('[data-reveal-button]');
    if (!this.button) return;

    this.button.addEventListener('click', () => this.toggle());
    this.button.addEventListener('pointerdown', () => this.prepareImages(), { once: true });

    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        this.observer.disconnect();
        this.prepareImages();
      },
      { rootMargin: '200px' },
    );
    this.observer.observe(this.button);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    cancelAnimationFrame(this.scrollFrame);
  }

  get expanded() {
    return this.button.getAttribute('aria-expanded') === 'true';
  }

  get hiddenItems() {
    return [...this.list.children].slice(VISIBLE_ON_MOBILE);
  }

  prepareImages() {
    if (!this.imagesReady) {
      const pending = this.hiddenItems
        .flatMap((item) => [...item.querySelectorAll('img')])
        .filter((image) => !image.complete);

      pending.forEach((image) => image.setAttribute('loading', 'eager'));
      this.imagesReady = Promise.allSettled(pending.map((image) => image.decode()));
    }

    return Promise.race([this.imagesReady, new Promise((resolve) => setTimeout(resolve, DECODE_TIMEOUT))]);
  }

  scrollTarget() {
    const section = this.closest('section') || this;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const top = section.getBoundingClientRect().top + window.scrollY;

    return clamp(top, 0, Math.max(maxScroll, 0));
  }

  scrollToTop(duration) {
    const section = this.closest('section') || this;
    if (section.getBoundingClientRect().top >= 0) return;

    if (!duration) {
      window.scrollTo(0, this.scrollTarget());
      return;
    }

    const from = window.scrollY;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);

      window.scrollTo(0, from + (this.scrollTarget() - from) * easeOutCubic(progress));
      if (progress < 1) this.scrollFrame = requestAnimationFrame(step);
    };

    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(step);
  }

  measure(expand) {
    const from = this.list.getBoundingClientRect().height;
    this.list.style.height = '';
    this.removeAttribute('data-collapsed');

    const fullHeight = this.list.getBoundingClientRect().height;
    const firstHidden = this.hiddenItems[0];
    const rowGap = parseFloat(getComputedStyle(this.list).rowGap) || 0;
    const collapsedHeight = firstHidden
      ? firstHidden.getBoundingClientRect().top - this.list.getBoundingClientRect().top - rowGap
      : fullHeight;

    return { from, to: expand ? fullHeight : collapsedHeight };
  }

  async toggle() {
    const expand = !this.expanded;

    this.button.setAttribute('aria-expanded', String(expand));
    this.button.textContent = expand ? 'Show Less' : 'Show More';

    this.pending = expand;
    if (expand) await this.prepareImages();
    if (this.pending !== expand) return;

    this.animation?.cancel();

    const duration = reducedMotionQuery.matches ? 0 : REVEAL_DURATION;
    const { from, to } = this.measure(expand);

    if (!expand) this.scrollToTop(duration);

    this.list.style.overflow = 'clip';
    this.list.style.contain = 'layout paint';

    this.animation = this.list.animate(
      { height: [`${from}px`, `${to}px`] },
      { duration, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
    );

    try {
      await this.animation.finished;
    } catch {
      return;
    }

    this.list.style.removeProperty('overflow');
    this.list.style.removeProperty('contain');
    this.toggleAttribute('data-collapsed', !expand);
  }
}

document.querySelectorAll('[data-rating]').forEach((rating) => {
  rating.style.setProperty('--rating', clamp(Number(rating.dataset.rating) || 0, 0, 5));
});

customElements.define('product-slider', ProductSlider);
customElements.define('product-reveal', ProductReveal);
