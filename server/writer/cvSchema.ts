import { z } from 'zod/v4';
import { EducationSchema, ExperienceSchema, ProjectSchema } from '../services/profileStore.ts';

/**
 * The tailored CV. Same shape as v1 (server/ai/tailor.ts re-exports it), so the
 * studio, the v1 routes and the form filler keep reading `applications.cv`.
 * "Currently learning" is a skills group with that exact name.
 */
export const TailoredCvSchema = z.object({
  name: z.string(),
  headline: z.string(),
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  }),
  summary: z.string(),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  education: z.array(EducationSchema),
  certifications: z.array(z.string()),
});
export type TailoredCv = z.infer<typeof TailoredCvSchema>;

export const LEARNING_GROUP_NAME = 'Currently learning';
