import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Muhammad Rajib Hawlader about engineering work, collaboration or an article on this site.",
  alternates: { canonical: "/contact/" },
};

export default function ContactPage() {
  return (
    <section className="section-padding py-16">
      <ContactForm />
    </section>
  );
}
