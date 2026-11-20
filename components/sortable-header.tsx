import Link from "next/link";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export function SortIcon(props: { direction: "asc" | "desc" | "none" }) {
  if (props.direction === "asc") {
    return <ArrowUp className="inline ml-2" />;
  }
  if (props.direction === "desc") {
    return <ArrowDown className="inline ml-2" />;
  }
  return <ArrowUpDown className="inline ml-2" />;
}

export function SortButtonHeader(props: {
  label: string;
  direction: "asc" | "desc" | "none";
  onClick: () => void;
  thClassName?: string;
}) {
  const ariaSortValue =
    props.direction === "asc"
      ? "ascending"
      : props.direction === "desc"
        ? "descending"
        : undefined;

  return (
    <th
      className={props.thClassName}
      aria-sort={ariaSortValue}
    >
      <button
        type="button"
        onClick={props.onClick}
        className="inline-flex items-center gap-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {props.label}
        <SortIcon direction={props.direction} />
      </button>
    </th>
  );
}

export function SortLinkHeader(props: {
  label: string;
  direction: "asc" | "desc" | "none";
  href: string;
  thClassName?: string;
}) {
  const ariaSortValue =
    props.direction === "asc"
      ? "ascending"
      : props.direction === "desc"
        ? "descending"
        : undefined;

  return (
    <th
      className={props.thClassName}
      aria-sort={ariaSortValue}
    >
      <Link
        href={props.href}
        className="inline-flex items-center gap-1 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {props.label}
        <SortIcon direction={props.direction} />
      </Link>
    </th>
  );
}
