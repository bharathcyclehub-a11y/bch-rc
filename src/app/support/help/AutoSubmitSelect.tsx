"use client";

/** A <select> that submits its GET form on change (the form keeps a submit button for no-JS). */
export default function AutoSubmitSelect({
  id,
  name,
  defaultValue,
  options,
  placeholder,
  className = "",
}: {
  id: string;
  name: string;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={`w-full min-h-12 min-w-0 rounded-xl border-2 border-brand-line bg-white px-3 text-base text-brand-ink focus:border-brand-red focus:outline-none ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
