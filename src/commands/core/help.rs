use anyhow::Result;
use poise::CreateReply;
use serenity::all::{CreateEmbed, CreateEmbedAuthor};
use chupkarivy_utils::discord::Colors;

use crate::bot::Context;

const HELP_MESSAGE: &str = include_str!("help.md");

/// Displays the help message
#[poise::command(slash_command)]
pub async fn help(ctx: Context<'_>) -> Result<()> {
    ctx.send(
        CreateReply::default().embed(
            CreateEmbed::new()
                .author(
                    CreateEmbedAuthor::new("ChupkarIvy Help")
                        .icon_url("https://github.com/Caxeyx/ChupkarIvy/logo-standard.webp"),
                )
                .description(HELP_MESSAGE)
                .color(Colors::Info),
        ),
    )
    .await?;

    Ok(())
}
