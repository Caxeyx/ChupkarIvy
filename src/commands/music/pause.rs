use anyhow::Result;
use poise::CreateReply;
use serenity::all::CreateEmbed;
use chupkarivy_session::manager::SessionQuery;
use chupkarivy_utils::discord::Colors;

use crate::bot::Context;

/// Pause current music playback
#[poise::command(slash_command, guild_only)]
pub async fn pause(ctx: Context<'_>) -> Result<()> {
    let manager = ctx.data();
    let guild = ctx.guild_id().expect("poise lied to me");

    let Some(session) = manager.get_session(SessionQuery::Guild(guild)) else {
        ctx.send(
            CreateReply::default()
                .embed(
                    CreateEmbed::new()
                        .title("Cannot pause playback")
                        .description("I'm currently not connected to any voice channel.")
                        .color(Colors::Error),
                )
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    };

    let player = session.player().await?;
    player.pause().await;

    ctx.send(
        CreateReply::default().embed(
            CreateEmbed::new()
                .title("Paused Playback")
                .description("⏸️ Music playback has been paused.")
                .color(Colors::Info),
        ),
    )
    .await?;

    Ok(())
}
