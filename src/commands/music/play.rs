use anyhow::Result;
use poise::CreateReply;
use serenity::all::CreateEmbed;
use chupkarivy_session::manager::SessionQuery;
use chupkarivy_utils::discord::Colors;

use crate::bot::Context;

/// Resume music playback
#[poise::command(slash_command, guild_only)]
pub async fn play(ctx: Context<'_>) -> Result<()> {
    let manager = ctx.data();
    let guild = ctx.guild_id().expect("poise lied to me");

    let Some(session) = manager.get_session(SessionQuery::Guild(guild)) else {
        ctx.send(
            CreateReply::default()
                .embed(
                    CreateEmbed::new()
                        .title("Cannot resume playback")
                        .description("I'm currently not connected to any voice channel. Use `/join` to start listening!")
                        .color(Colors::Error),
                )
                .ephemeral(true),
        )
        .await?;
        return Ok(());
    };

    let player = session.player().await?;
    player.play().await;

    ctx.send(
        CreateReply::default().embed(
            CreateEmbed::new()
                .title("Resumed Playback")
                .description("▶️ Music playback has been resumed.")
                .color(Colors::Info),
        ),
    )
    .await?;

    Ok(())
}
