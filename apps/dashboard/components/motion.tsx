'use client';

import type { CSSProperties, ReactNode } from 'react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type Variants } from 'framer-motion';

const EASE = [0.22, 1, 0.36, 1] as const;

interface RevealProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Seconds to wait before the animation starts. */
  delay?: number;
  /** Distance to rise, in pixels. */
  y?: number;
  /** Play on page load instead of when scrolled into view (for the hero). */
  onLoad?: boolean;
}

/** Fades and lifts its children in, once, when they scroll into view. Does nothing when the visitor prefers reduced motion. */
export function Reveal({ children, className, style, delay = 0, y = 28, onLoad = false }: RevealProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className} style={style}>{children}</div>;
  const from = { opacity: 0, y };
  const to = { opacity: 1, y: 0 };
  const transition = { duration: 0.75, ease: EASE, delay };
  return onLoad ? (
    <motion.div className={className} style={style} initial={from} animate={to} transition={transition}>
      {children}
    </motion.div>
  ) : (
    <motion.div className={className} style={style} initial={from} whileInView={to} viewport={{ once: true, margin: '-80px' }} transition={transition}>
      {children}
    </motion.div>
  );
}

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.09 } } };
const item: Variants = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } } };

/** A group whose Item children animate in one after another when the group scrolls into view. */
export function Stagger({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className} style={style}>{children}</div>;
  return (
    <motion.div className={className} style={style} variants={container} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}>
      {children}
    </motion.div>
  );
}

export function Item({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className} style={style}>{children}</div>;
  return (
    <motion.div className={className} style={style} variants={item}>
      {children}
    </motion.div>
  );
}

/** The hero text drifts up and fades as the page scrolls away from it. */
export function HeroScroll({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 520], [0, -70]);
  const opacity = useTransform(scrollY, [0, 460], [1, 0.15]);
  if (reduce) return <>{children}</>;
  return <motion.div style={{ y, opacity }}>{children}</motion.div>;
}

/** A thin bar at the top of the page showing how far down it you are. */
export function ScrollProgress() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });
  if (reduce) return null;
  return (
    <motion.div
      aria-hidden
      style={{ scaleX, position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: 'var(--brand)', transformOrigin: '0 50%', zIndex: 100 }}
    />
  );
}
