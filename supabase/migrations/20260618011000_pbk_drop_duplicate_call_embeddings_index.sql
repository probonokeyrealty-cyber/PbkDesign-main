-- Drop the standalone duplicate of call_embeddings' uniqueness constraint.
--
-- call_embeddings_workspace_id_call_id_embedding_model_key backs the table
-- constraint and must stay. This index has the same key columns but is not
-- constraint-backed, so it only adds write overhead and advisor noise.

DROP INDEX IF EXISTS public.call_embeddings_workspace_call_model_idx;
