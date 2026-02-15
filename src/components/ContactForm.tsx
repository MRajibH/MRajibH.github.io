"use client";

import { useState } from "react";
import { contact } from "@/data/resume";
import { FiSend, FiLoader, FiCheckCircle, FiAlertCircle } from "react-icons/fi";

export function ContactForm() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        message: "",
    });
    const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus("submitting");

        // FormSubmit.co submission
        // This service works by just using your email address in the URL.
        // It will send you a confirmation email for the first submission.
        const FORMSUBMIT_ENDPOINT = `https://formsubmit.co/${contact.email}`;

        try {
            const response = await fetch(FORMSUBMIT_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    ...formData,
                    _subject: `New Message from ${formData.name}`,
                    _template: "table",
                    _captcha: "false"
                }),
            });

            if (response.ok) {
                setStatus("success");
                setFormData({ name: "", email: "", message: "" });
            } else {
                setStatus("error");
            }
        } catch (error) {
            console.error("Submission error:", error);
            setStatus("error");
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    return (
        <div className="max-w-xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-light mb-6 text-center">
                Get In Touch
            </h2>
            <p className="text-slate text-center mb-8">
                Have a project in mind or want to collaborate? Send me a message below or email me directly at{" "}
                <a href={`mailto:${contact.email}`} className="text-accent hover:underline">
                    {contact.email}
                </a>.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-light mb-1">
                        Name
                    </label>
                    <input
                        type="text"
                        id="name"
                        name="name"
                        required
                        value={formData.name}
                        onChange={handleChange}
                        className="w-full px-4 py-3 rounded-lg bg-navy-light/50 border border-white/10 text-slate-light placeholder-slate/50 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-colors"
                        placeholder="Your Name"
                    />
                </div>

                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-light mb-1">
                        Email
                    </label>
                    <input
                        type="email"
                        id="email"
                        name="email"
                        required
                        value={formData.email}
                        onChange={handleChange}
                        className="w-full px-4 py-3 rounded-lg bg-navy-light/50 border border-white/10 text-slate-light placeholder-slate/50 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-colors"
                        placeholder="your@email.com"
                    />
                </div>

                <div>
                    <label htmlFor="message" className="block text-sm font-medium text-slate-light mb-1">
                        Message
                    </label>
                    <textarea
                        id="message"
                        name="message"
                        required
                        value={formData.message}
                        onChange={handleChange}
                        rows={5}
                        className="w-full px-4 py-3 rounded-lg bg-navy-light/50 border border-white/10 text-slate-light placeholder-slate/50 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-colors resize-none"
                        placeholder="How can I help you?"
                    />
                </div>

                <button
                    type="submit"
                    disabled={status === "submitting" || status === "success"}
                    className={`w-full py-4 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${status === "success"
                        ? "bg-green-500/20 text-green-400 border border-green-500/50 cursor-default"
                        : "bg-accent text-navy hover:shadow-glow hover:scale-[1.02] disabled:opacity-70 disabled:cursor-not-allowed"
                        }`}
                >
                    {status === "submitting" ? (
                        <>
                            <FiLoader className="animate-spin" /> Sending...
                        </>
                    ) : status === "success" ? (
                        <>
                            <FiCheckCircle /> Message Sent!
                        </>
                    ) : (
                        <>
                            <FiSend /> Send Message
                        </>
                    )}
                </button>

                {status === "error" && (
                    <div className="flex items-center gap-2 text-red-400 text-sm mt-2 justify-center">
                        <FiAlertCircle />
                        <span>Something went wrong. Please try again or email directly.</span>
                    </div>
                )}
            </form>
        </div>
    );
}
